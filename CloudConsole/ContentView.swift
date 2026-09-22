import SwiftUI

struct ContentView: View {
    @ObservedObject private var lockManager = AppLockManager.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            HomeView()
            if lockManager.isLocked {
                LockScreenView(manager: lockManager)
                    .transition(.opacity)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { lockManager.lock() }
        }
    }
}

#Preview {
    ContentView()
}
