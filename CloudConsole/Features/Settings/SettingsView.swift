import SwiftUI

struct SettingsView: View {
    @State private var awsCredential = KeychainStore.load(forKey: KeychainStore.awsCredentialStorageKey) ?? ""

    var body: some View {
        NavigationStack {
            Form {
                Section("AWS credential") {
                    SecureField("Access key / secret", text: $awsCredential)
                    Button("Save") {
                        KeychainStore.save(awsCredential, forKey: KeychainStore.awsCredentialStorageKey)
                    }
                    Button("Remove", role: .destructive) {
                        KeychainStore.delete(forKey: KeychainStore.awsCredentialStorageKey)
                        awsCredential = ""
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}

#Preview {
    SettingsView()
}
