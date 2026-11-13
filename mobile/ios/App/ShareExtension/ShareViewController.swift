import UIKit
import UniformTypeIdentifiers

/// "Parley" in the iOS share sheet: copies what was shared (a link, text, photos, videos, files) into the App Group's
/// `Shared/` folder as `share.json` plus the files, then opens the app at `parley://share`, where the web client shows
/// its "Share to…" picker (App/ParleySharePlugin.swift reads the folder).
@objc(ShareViewController)
class ShareViewController: UIViewController {
    private static let group = "group.com.runparley.app"
    private static let maxFiles = 10
    private var started = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.043, green: 0.047, blue: 0.063, alpha: 1)
        let spinner = UIActivityIndicatorView(style: .large)
        spinner.color = .white
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimating()
        view.addSubview(spinner)
        NSLayoutConstraint.activate([spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor), spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if started { return }
        started = true
        Task { @MainActor in
            let saved = await self.save()
            if !saved { self.done(); return }
            if self.openApp() { self.done() } else { self.tellToOpen() }
        }
    }

    private func done() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    /// The app couldn't be opened from here: what was shared waits for it, and it shows up the next time it's opened.
    private func tellToOpen() {
        let a = UIAlertController(title: "Ready in Parley", message: "Open Parley to choose where to share it.", preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in self?.done() })
        present(a, animated: true)
    }

    // MARK: Collecting

    private struct Saved: Codable { var name: String; var type: String; var file: String }
    private struct Manifest: Codable { var text: String?; var url: String?; var title: String?; var files: [Saved] }

    private func save() async -> Bool {
        guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.group) else { return false }
        let fm = FileManager.default
        // Written beside the inbox and moved in whole, so the app never reads half a share.
        let staging = root.appendingPathComponent("Staging-\(UUID().uuidString)", isDirectory: true)
        try? fm.createDirectory(at: staging, withIntermediateDirectories: true)
        var m = Manifest(text: nil, url: nil, title: nil, files: [])
        var texts: [String] = []
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        for item in items {
            if let t = item.attributedContentText?.string, !t.isEmpty { texts.append(t) }
            for p in item.attachments ?? [] {
                if p.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) || isMedia(p) {
                    if m.files.count < Self.maxFiles, let f = await copyFile(p, into: staging, index: m.files.count) { m.files.append(f) }
                } else if p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    if let u = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                        if u.isFileURL {
                            if m.files.count < Self.maxFiles, let f = copy(u, into: staging, index: m.files.count, type: nil) { m.files.append(f) }
                        } else if m.url == nil { m.url = u.absoluteString }
                    }
                } else if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    if let t = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String, !t.isEmpty { texts.append(t) }
                } else if m.files.count < Self.maxFiles, let f = await copyFile(p, into: staging, index: m.files.count) {
                    m.files.append(f)
                }
            }
        }
        // A page shared from Safari brings its title as the item's text and its address as a URL: keep the text only
        // when it says something the link doesn't.
        let joined = ((NSOrderedSet(array: texts).array as? [String]) ?? texts).joined(separator: "\n")
        if !joined.isEmpty && joined != m.url { m.text = joined }
        if m.text == nil && m.url == nil && m.files.isEmpty { try? fm.removeItem(at: staging); return false }
        guard let json = try? JSONEncoder().encode(m) else { return false }
        do {
            try json.write(to: staging.appendingPathComponent("share.json"))
            let inbox = root.appendingPathComponent("Shared", isDirectory: true)
            try? fm.removeItem(at: inbox)
            try fm.moveItem(at: staging, to: inbox)
            return true
        } catch {
            try? fm.removeItem(at: staging)
            return false
        }
    }

    private func isMedia(_ p: NSItemProvider) -> Bool {
        p.hasItemConformingToTypeIdentifier(UTType.image.identifier) || p.hasItemConformingToTypeIdentifier(UTType.movie.identifier)
            || p.hasItemConformingToTypeIdentifier(UTType.audio.identifier) || p.hasItemConformingToTypeIdentifier(UTType.pdf.identifier)
    }

    /// The item's data as a file: pictures as JPEG or PNG (browsers can't show HEIC), everything else as it comes.
    private func copyFile(_ p: NSItemProvider, into dir: URL, index: Int) async -> Saved? {
        let ids = p.registeredTypeIdentifiers
        let preferred = [UTType.jpeg, UTType.png, UTType.gif, UTType.webP].map(\.identifier)
        let isImage = p.hasItemConformingToTypeIdentifier(UTType.image.identifier)
        if isImage, let id = preferred.first(where: { ids.contains($0) }), let url = await fileRepresentation(p, id), let f = copy(url, into: dir, index: index, type: UTType(id), name: p.suggestedName) { return f }
        if isImage, ids.contains(where: { UTType($0)?.conforms(to: .heic) == true || UTType($0)?.conforms(to: .heif) == true }),
           let id = ids.first(where: { UTType($0)?.conforms(to: .image) == true }), let url = await fileRepresentation(p, id),
           let img = UIImage(contentsOfFile: url.path), let jpeg = img.jpegData(compressionQuality: 0.9) {
            let base = ((p.suggestedName ?? url.lastPathComponent) as NSString).deletingPathExtension
            let name = "\(base.isEmpty ? "photo" : base).jpg"
            let file = "\(index)-\(name)"
            guard (try? jpeg.write(to: dir.appendingPathComponent(file))) != nil else { return nil }
            return Saved(name: name, type: "image/jpeg", file: file)
        }
        guard let id = ids.first(where: { UTType($0)?.conforms(to: .data) == true }) ?? ids.first,
              let url = await fileRepresentation(p, id) else { return nil }
        return copy(url, into: dir, index: index, type: UTType(id), name: p.suggestedName)
    }

    private func fileRepresentation(_ p: NSItemProvider, _ id: String) async -> URL? {
        await withCheckedContinuation { (k: CheckedContinuation<URL?, Never>) in
            _ = p.loadFileRepresentation(forTypeIdentifier: id) { url, _ in
                // The provider deletes its copy when this returns: keep one of our own.
                guard let url = url else { k.resume(returning: nil); return }
                let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-" + url.lastPathComponent)
                k.resume(returning: (try? FileManager.default.copyItem(at: url, to: tmp)) != nil ? tmp : nil)
            }
        }
    }

    private func copy(_ url: URL, into dir: URL, index: Int, type: UTType?, name: String? = nil) -> Saved? {
        let t = type ?? UTType(filenameExtension: url.pathExtension)
        var n = (name?.isEmpty == false ? name! : url.lastPathComponent)
        if (n as NSString).pathExtension.isEmpty, let ext = t?.preferredFilenameExtension ?? (url.pathExtension.isEmpty ? nil : url.pathExtension) { n += ".\(ext)" }
        let file = "\(index)-\(n)"
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard (try? FileManager.default.copyItem(at: url, to: dir.appendingPathComponent(file))) != nil else { return nil }
        return Saved(name: n, type: t?.preferredMIMEType ?? "application/octet-stream", file: file)
    }

    // MARK: Opening the app

    /// Share extensions can't call UIApplication.shared; the app object is found up the responder chain and asked to
    /// open the URL through the Objective-C runtime.
    private func openApp() -> Bool {
        guard let url = URL(string: "parley://share") else { return false }
        let sel = NSSelectorFromString("openURL:options:completionHandler:")
        var r: UIResponder? = self
        while let cur = r {
            if cur.responds(to: sel), String(describing: type(of: cur)).contains("Application") {
                typealias Open = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, (@convention(block) (Bool) -> Void)?) -> Void
                let imp = cur.method(for: sel)
                unsafeBitCast(imp, to: Open.self)(cur, sel, url as NSURL, NSDictionary(), nil)
                return true
            }
            r = cur.next
        }
        return false
    }
}
