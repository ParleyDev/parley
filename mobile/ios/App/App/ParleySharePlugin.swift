import Foundation
import UIKit
import Capacitor

/// Sharing into Parley from other apps. The share extension (ShareExtension/) copies what was shared into the App
/// Group's `Shared/` folder (`share.json` plus the files) and opens `parley://share`; the web client then asks for it
/// with `ParleyShare.take()` and opens its "Share to…" picker. A share arriving while the app is open, or found when it
/// comes back to the front, fires `shared` so the web client asks right away.
///
/// The other way, `ParleyShare.save({ url, name })` saves a file from a chat to the phone: downloaded to a temporary
/// file (so a video too big to hold in memory saves too), then the share sheet with it (Save Video, Save Image, Save
/// to Files). The web view cannot download, and opening the file's address left the app for the browser.
@objc(ParleySharePlugin)
public class ParleySharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ParleySharePlugin"
    public let jsName = "ParleyShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
    ]

    static let didShare = Notification.Name("ParleyDidShare")

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(shared), name: ParleySharePlugin.didShare, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func shared() {
        notifyListeners("shared", data: [:], retainUntilConsumed: true)
    }

    @objc private func becameActive() {
        if ShareInbox.hasPending { shared() }
    }

    @objc func take(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            call.resolve(ShareInbox.take())
        }
    }

    /// Resolves `{ done }` (whether something was done with the file) once the share sheet closes.
    @objc func save(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https" || url.scheme == "http" else {
            call.reject("Not a file address")
            return
        }
        let name = ParleySharePlugin.fileName(call.getString("name") ?? url.lastPathComponent)
        URLSession.shared.downloadTask(with: url) { tmp, response, error in
            let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
            guard let tmp = tmp, error == nil, ok else {
                call.reject(error?.localizedDescription ?? "The file could not be downloaded")
                return
            }
            // Under its own name (the share sheet and Files show it), in a folder of its own, removed afterwards.
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("ParleySave-\(UUID().uuidString)", isDirectory: true)
            let file = dir.appendingPathComponent(name)
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try FileManager.default.moveItem(at: tmp, to: file)
            } catch {
                call.reject("The file could not be kept")
                return
            }
            DispatchQueue.main.async {
                guard let vc = self.bridge?.viewController else {
                    try? FileManager.default.removeItem(at: dir)
                    call.reject("No window to show it in")
                    return
                }
                let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                sheet.completionWithItemsHandler = { _, completed, _, _ in
                    try? FileManager.default.removeItem(at: dir)
                    call.resolve(["done": completed])
                }
                // iPad: the sheet is a popover, from the middle of the screen.
                if let pop = sheet.popoverPresentationController {
                    pop.sourceView = vc.view
                    pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
                    pop.permittedArrowDirections = []
                }
                vc.present(sheet, animated: true)
            }
        }.resume()
    }

    /// A name safe to give a file: no path separators, not empty, not too long.
    static func fileName(_ raw: String) -> String {
        let parts = raw.components(separatedBy: CharacterSet(charactersIn: "/\\:"))
        let cleaned = parts.joined(separator: "_").trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "file" : String(cleaned.prefix(200))
    }
}

/// The App Group folder the share extension writes to (the same layout as ShareViewController's).
enum ShareInbox {
    static let group = "group.com.runparley.app"
    /// Big files are left out: they'd go through the bridge in memory, and the server's upload limit is lower anyway.
    static let maxFile = 100 * 1024 * 1024

    static var folder: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("Shared", isDirectory: true)
    }

    static var hasPending: Bool {
        guard let f = folder else { return false }
        return FileManager.default.fileExists(atPath: f.appendingPathComponent("share.json").path)
    }

    /// What was shared, as `{ text, url, title, files: [{ name, type, data (base64) }] }`, and the folder emptied.
    static func take() -> [String: Any] {
        guard let f = folder,
              let raw = try? Data(contentsOf: f.appendingPathComponent("share.json")),
              let json = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any] else { return [:] }
        defer { try? FileManager.default.removeItem(at: f) }
        var out: [String: Any] = [:]
        for k in ["text", "url", "title"] { if let v = json[k] as? String, !v.isEmpty { out[k] = v } }
        var files: [[String: Any]] = []
        for item in (json["files"] as? [[String: Any]]) ?? [] {
            guard let file = item["file"] as? String,
                  let data = try? Data(contentsOf: f.appendingPathComponent(file)),
                  data.count <= maxFile else { continue }
            files.append([
                "name": (item["name"] as? String) ?? file,
                "type": (item["type"] as? String) ?? "application/octet-stream",
                "data": data.base64EncodedString(),
            ])
        }
        if !files.isEmpty { out["files"] = files }
        return out
    }
}
