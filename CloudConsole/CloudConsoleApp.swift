import SwiftUI

/// Only exists to receive the background-URLSession wake event and hand it to the
/// operation queue — SwiftUI's `App` protocol has no hook for this itself.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier == "com.solomonxie.cloudconsole.s3ops" else {
            completionHandler()
            return
        }
        Task { @MainActor in
            S3OperationQueue.shared.backgroundCompletionHandler = completionHandler
        }
    }
}

@main
struct CloudConsoleApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
