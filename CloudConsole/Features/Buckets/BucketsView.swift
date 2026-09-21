import SwiftUI

struct BucketsView: View {
    var body: some View {
        NavigationStack {
            List {
                Text("Bucket / object browser coming soon")
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("Buckets")
        }
    }
}

#Preview {
    BucketsView()
}
