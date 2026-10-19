import Foundation
import UIKit
import CoreLocation
import Capacitor

/// Records the location while a shift is open – screen locked or app in the background – and sends it to {api}/worker/ping.
/// With "Always" permission, iOS also relaunches the app after it was closed (significant location change) and recording resumes.
final class LsTracker: NSObject, CLLocationManagerDelegate {
    static let shared = LsTracker()
    private let manager = CLLocationManager()
    private let defaults = UserDefaults.standard
    private var lastKept: CLLocation?
    private var lastKeptAt: Date?
    private var sending = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 30
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .other
    }

    var shiftOpen: Bool { defaults.bool(forKey: "ls.on") && Date().timeIntervalSince1970 * 1000 < defaults.double(forKey: "ls.until") }
    var queued: Int { (defaults.array(forKey: "ls.queue") ?? []).count }

    func authStatus() -> CLAuthorizationStatus {
        if #available(iOS 14.0, *) { return manager.authorizationStatus }
        return CLLocationManager.authorizationStatus()
    }

    func start(api: String, token: String, until: Double) {
        defaults.set(true, forKey: "ls.on"); defaults.set(api, forKey: "ls.api"); defaults.set(token, forKey: "ls.token")
        defaults.set(until, forKey: "ls.until"); defaults.set(false, forKey: "ls.tokenExpired")
        resumeIfShift()
    }

    func stop() {
        defaults.set(false, forKey: "ls.on")
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        flush()
    }

    func setToken(_ token: String, api: String?) {
        defaults.set(token, forKey: "ls.token"); defaults.set(false, forKey: "ls.tokenExpired")
        if let api = api, !api.isEmpty { defaults.set(api, forKey: "ls.api") }
        flush(); resumeIfShift()
    }

    /// Called at check-in, on every app start (also a background relaunch) and when permission changes
    func resumeIfShift() {
        guard shiftOpen else { return }
        let st = authStatus()
        guard st == .authorizedAlways || st == .authorizedWhenInUse else { return }
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        if st == .authorizedAlways { manager.startMonitoringSignificantLocationChanges() }
    }

    func requestWhenInUse() { manager.requestWhenInUseAuthorization() }
    func requestAlways() { manager.requestAlwaysAuthorization() }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard shiftOpen else { stop(); return }
        for l in locations where l.horizontalAccuracy >= 0 {
            let due = lastKeptAt.map { Date().timeIntervalSince($0) >= 300 } ?? true      // every 5 minutes
            let moved = lastKept.map { l.distance(from: $0) >= 30 } ?? true               // or after 30 m
            if due || moved { queue(l); lastKept = l; lastKeptAt = Date() }
        }
        flush()
    }

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) { resumeIfShift() }
    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) { }

    private func queue(_ l: CLLocation) {
        var q = defaults.array(forKey: "ls.queue") as? [[String: Double]] ?? []
        q.append(["ts": (l.timestamp.timeIntervalSince1970 * 1000).rounded(), "lat": l.coordinate.latitude, "lng": l.coordinate.longitude, "acc": l.horizontalAccuracy.rounded()])
        if q.count > 3000 { q.removeFirst(q.count - 3000) }
        defaults.set(q, forKey: "ls.queue")
    }

    /// Sends queued points in batches of 100; points stay on the phone when there is no signal or the sign-in expired
    func flush() {
        guard !sending, !defaults.bool(forKey: "ls.tokenExpired"),
              let api = defaults.string(forKey: "ls.api"), let token = defaults.string(forKey: "ls.token"), !api.isEmpty, !token.isEmpty else { return }
        let q = defaults.array(forKey: "ls.queue") as? [[String: Double]] ?? []
        var base = api; while base.hasSuffix("/") { base.removeLast() }
        guard !q.isEmpty, let url = URL(string: base + "/worker/ping") else { return }
        let batch = Array(q.prefix(100))
        var req = URLRequest(url: url)
        req.httpMethod = "POST"; req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["pts": batch])
        sending = true
        var bg: UIBackgroundTaskIdentifier = .invalid
        bg = UIApplication.shared.beginBackgroundTask { if bg != .invalid { UIApplication.shared.endBackgroundTask(bg); bg = .invalid } }
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.sending = false
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                var more = false
                if code == 401 { self.defaults.set(true, forKey: "ls.tokenExpired") }
                else if code == 200 || code == 400 {
                    let now = self.defaults.array(forKey: "ls.queue") as? [[String: Double]] ?? []
                    self.defaults.set(Array(now.dropFirst(min(batch.count, now.count))), forKey: "ls.queue")
                    self.defaults.set(Date().timeIntervalSince1970 * 1000, forKey: "ls.lastSent")
                    more = now.count > batch.count
                }
                if bg != .invalid { UIApplication.shared.endBackgroundTask(bg); bg = .invalid }
                if more { self.flush() }
            }
        }.resume()
    }
}

/// Bridge for the phone page – same methods as the Android app
@objc(LsTrackerPlugin)
public class LsTrackerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LsTrackerPlugin"
    public let jsName = "LsTracker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestBackground", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise)
    ]
    private var t: LsTracker { LsTracker.shared }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.t.start(api: call.getString("api") ?? "", token: call.getString("token") ?? "", until: call.getDouble("until") ?? (Date().timeIntervalSince1970 * 1000 + 16 * 3600000))
            call.resolve(self.status())
        }
    }
    @objc func stop(_ call: CAPPluginCall) { DispatchQueue.main.async { self.t.stop(); call.resolve(self.status()) } }
    @objc func setToken(_ call: CAPPluginCall) { DispatchQueue.main.async { self.t.setToken(call.getString("token") ?? "", api: call.getString("api")); call.resolve(self.status()) } }
    @objc func status(_ call: CAPPluginCall) { DispatchQueue.main.async { call.resolve(self.status()) } }
    @objc override public func requestPermissions(_ call: CAPPluginCall) { DispatchQueue.main.async { self.t.requestWhenInUse(); call.resolve(self.status()) } }
    @objc func requestBackground(_ call: CAPPluginCall) { DispatchQueue.main.async { self.t.requestAlways(); call.resolve(self.status()) } }

    private func status() -> [String: Any] {
        let st = t.authStatus()
        return ["running": t.shiftOpen, "queued": t.queued, "lastSent": UserDefaults.standard.double(forKey: "ls.lastSent"),
                "location": st == .authorizedAlways || st == .authorizedWhenInUse, "background": st == .authorizedAlways,
                "tokenExpired": UserDefaults.standard.bool(forKey: "ls.tokenExpired")]
    }
}

/// Registers the plugin with the app's web view (set as the storyboard's view controller)
class LsBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LsTrackerPlugin())
    }
}
