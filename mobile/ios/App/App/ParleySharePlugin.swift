import Foundation
import UIKit
import Capacitor

/// Sharing into Parley from other apps. The share extension (ShareExtension/) copies what was shared into the App
/// Group's `Shared/` folder (`share.json` plus the files) and opens `parley://share`; the web client then asks for it
/// with `ParleyShare.take()` and opens its "Share to…" picker. A share arriving while the app is open, or found when it
/// comes back to the front, fires `shared` so the web client asks right away.
@objc(ParleySharePlugin)
public class ParleySharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ParleySharePlugin"
    public let jsName = "ParleyShare"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise)]

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
