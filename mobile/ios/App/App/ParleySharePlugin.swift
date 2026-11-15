import Foundation
import UIKit
import Capacitor

/// Sharing into Parley from other apps. The share extension (ShareExtension/) copies what was shared into the App
/// Group's `Shared/` folder (`share.json` plus the files) and opens `parley://share`; the web client then asks for it
/// with `ParleyShare.take()` and opens its "Share to…" picker. A share arriving while the app is open, or found when it
/// comes back to the front, fires `shared` so the web client asks right away.
///
/// The other way, `ParleyShare.save({ url, name })` saves a file from a chat to the phone: downloaded in the background
/// to a temporary file (so a video too big to hold in memory saves too, and leaving the app doesn't stop it), then the
/// share sheet with it (Save Video, Save Image, Save
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

    /// Resolves `{ done }` (whether something was done with the file) once the share sheet closes. The download goes on
    /// in the background (SaveDownloads): someone who leaves the app while a long video comes down gets the sheet when
    /// they come back, instead of the transfer stopping with the app.
    @objc func save(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https" || url.scheme == "http" else {
            call.reject("Not a file address")
            return
        }
        let name = ParleySharePlugin.fileName(call.getString("name") ?? url.lastPathComponent)
        SaveDownloads.shared.start(url, name: name) { outcome in
            switch outcome {
            case .failed(let message): call.reject(message)
            case .saved(let dir, let file): ParleySharePlugin.whenActive { self.present(file, removing: dir, call) }
            }
        }
    }

    /// Now if the app is in front, else as soon as it is (a sheet can't be shown from the background).
    private static func whenActive(_ run: @escaping () -> Void) {
        DispatchQueue.main.async {
            if UIApplication.shared.applicationState == .active { run(); return }
            var token: NSObjectProtocol?
            token = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
                if let t = token { NotificationCenter.default.removeObserver(t) }
                token = nil
                run()
            }
        }
    }

    private func present(_ file: URL, removing dir: URL, _ call: CAPPluginCall) {
        // From whatever is in front (a video playing full screen, say): presenting from the bridge's own view
        // controller while it already presents something does nothing at all, and the call never ends.
        guard var vc = bridge?.viewController else {
            try? FileManager.default.removeItem(at: dir)
            call.reject("No window to show it in")
            return
        }
        while let top = vc.presentedViewController, !top.isBeingDismissed { vc = top }
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
        if sheet.presentingViewController == nil {
            try? FileManager.default.removeItem(at: dir)
            call.reject("The save sheet could not be shown")
        }
    }

    /// A name safe to give a file: no path separators, not empty, not too long.
    static func fileName(_ raw: String) -> String {
        let parts = raw.components(separatedBy: CharacterSet(charactersIn: "/\\:"))
        let cleaned = parts.joined(separator: "_").trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "file" : String(cleaned.prefix(200))
    }
}

/// Files being saved to the phone, downloaded by a background URLSession: iOS carries on with the transfer while the
/// app is in the background or suspended, and wakes it (AppDelegate's handleEventsForBackgroundURLSession) when done.
/// A download whose app was quit in the meantime has no one waiting for it and is dropped.
final class SaveDownloads: NSObject, URLSessionDownloadDelegate {
    static let shared = SaveDownloads()
    static let identifier = "com.runparley.app.save"

    enum Outcome {
        case saved(dir: URL, file: URL)
        case failed(String)
    }

    /// iOS's completion handler for a background wake-up, called once the session's events are delivered.
    var finishEvents: (() -> Void)?
    private var waiting: [Int: (name: String, done: (Outcome) -> Void)] = [:]
    private let lock = NSLock()

    lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: SaveDownloads.identifier)
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    func start(_ url: URL, name: String, done: @escaping (Outcome) -> Void) {
        let task = session.downloadTask(with: url)
        lock.lock(); waiting[task.taskIdentifier] = (name, done); lock.unlock()
        task.resume()
    }

    private func take(_ task: URLSessionTask) -> (name: String, done: (Outcome) -> Void)? {
        lock.lock(); defer { lock.unlock() }
        return waiting.removeValue(forKey: task.taskIdentifier)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // The temporary file is gone once this returns: kept now, under its own name (the share sheet and Files show
        // it), in a folder of its own, removed after the sheet.
        guard let entry = take(downloadTask) else { return }
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            entry.done(.failed("The file could not be downloaded (\(status))"))
            return
        }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("ParleySave-\(UUID().uuidString)", isDirectory: true)
        let file = dir.appendingPathComponent(entry.name)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: location, to: file)
        } catch {
            entry.done(.failed("The file could not be kept"))
            return
        }
        entry.done(.saved(dir: dir, file: file))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        // Only failures are still waiting here: a finished download was handed over above.
        guard let entry = take(task) else { return }
        entry.done(.failed(error?.localizedDescription ?? "The file could not be downloaded"))
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.finishEvents?()
            self.finishEvents = nil
        }
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
