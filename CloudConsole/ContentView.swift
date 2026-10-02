import SwiftUI

struct ContentView: View {
    @ObservedObject private var lockManager = AppLockManager.shared
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(AppData.demoKey) private var demoOn = false
    @AppStorage(AppData.demoGenerationKey) private var demoGeneration = 0

    var body: some View {
        ZStack {
            HomeView()
                .id("\(demoOn)-\(demoGeneration)")
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
