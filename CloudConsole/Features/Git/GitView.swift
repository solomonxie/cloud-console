import SwiftUI

struct GitView: View {
    @State private var repos: [GitHubRepoLink] = []
    @State private var token = ""

    var body: some View {
        NavigationStack {
            List {
                Section("Connected GitHub repos") {
                    if repos.isEmpty {
                        Text("No repos connected yet")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(repos) { repo in
                            Text(repo.fullName)
                        }
                    }
                }
                Section("Personal access token") {
                    SecureField("ghp_...", text: $token)
                }
            }
            .navigationTitle("Git")
        }
    }
}

#Preview {
    GitView()
}
