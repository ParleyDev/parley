import Foundation
import UIKit
import UserNotifications
import Capacitor

/// The number on the app icon while the app is open: `ParleyBadge.set({ count })`, kept in step with the web client's
/// own unread badge (mentions, unread DMs and requests). The web view can't set it itself (no Badging API in an app's
/// WKWebView). While the app is closed, pushes carry the number instead.
@objc(ParleyBadgePlugin)
public class ParleyBadgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ParleyBadgePlugin"
    public let jsName = "ParleyBadge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
    ]

    @objc func set(_ call: CAPPluginCall) {
        let count = max(0, call.getInt("count") ?? 0)
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(count) { _ in call.resolve() }
            } else {
                UIApplication.shared.applicationIconBadgeNumber = count
                call.resolve()
            }
        }
    }
}
