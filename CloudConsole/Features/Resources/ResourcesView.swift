import SwiftUI

struct ResourcesView: View {
    var body: some View {
        NavigationStack {
            List(CloudProvider.allCases) { provider in
                NavigationLink(provider.rawValue) {
                    ProviderResourceListView(provider: provider)
                }
            }
            .navigationTitle("Resources")
        }
    }
}

struct ProviderResourceListView: View {
    let provider: CloudProvider

    var body: some View {
        List {
            Text("EC2 instances")
            Text("Lambda functions")
            Text("Databases")
        }
        .foregroundStyle(.secondary)
        .navigationTitle(provider.rawValue)
    }
}

#Preview {
    ResourcesView()
}
