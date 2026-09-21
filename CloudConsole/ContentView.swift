import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            ResourcesView()
                .tabItem { Label("Resources", systemImage: "server.rack") }
            BucketsView()
                .tabItem { Label("Buckets", systemImage: "shippingbox") }
            TerraformView()
                .tabItem { Label("Terraform", systemImage: "hammer") }
            GitView()
                .tabItem { Label("Git", systemImage: "arrow.triangle.branch") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}

#Preview {
    ContentView()
}
