import SwiftUI

struct AddCloudView: View {
    @ObservedObject var store: HomeStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(CloudVendor.allCases) { vendor in
                NavigationLink {
                    CredentialFormView(store: store, vendor: vendor) {
                        dismiss()
                    }
                } label: {
                    Label(vendor.rawValue, systemImage: vendor.icon)
                }
            }
            .navigationTitle("Add connection")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

struct CredentialFormView: View {
    @ObservedObject var store: HomeStore
    let vendor: CloudVendor
    let onAdded: () -> Void

    @State private var name = ""
    @State private var primaryField = ""
    @State private var secondaryField = ""
    @State private var showingInfo = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var isPasteMode = false
    @State private var pasteText = ""

    var body: some View {
        Form {
            Section {
                credentialFields
                Link("Learn how to create →", destination: vendor.learnMoreURL)
                    .font(.footnote)
            } header: {
                HStack {
                    Text("Access key")
                    if isPasteEligible {
                        Button {
                            togglePasteMode()
                        } label: {
                            Text(isPasteMode ? "(back to fields)" : "(paste info to add)")
                                .foregroundStyle(.blue)
                        }
                        .buttonStyle(.plain)
                        .font(.caption)
                    }
                    Spacer()
                    Button {
                        showingInfo = true
                    } label: {
                        Image(systemName: "info.circle")
                    }
                    .buttonStyle(.plain)
                }
            } footer: {
                Text("Stored only in this device's Keychain. This app only ever does what this key's own permissions allow.")
            }

            Section {
                TextField("Label (optional)", text: $name)
                Text("Helps tell multiple \(vendor.rawValue) connections apart")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }

            Section {
                Button {
                    submit()
                } label: {
                    if isSubmitting {
                        HStack {
                            ProgressView()
                            Text("Testing & adding…")
                        }
                    } else {
                        Text("Test & add")
                    }
                }
                .disabled(!canSubmit || isSubmitting)
            }
        }
        .navigationTitle("Add \(vendor.rawValue)")
        .popover(isPresented: $showingInfo) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Where to find this").font(.headline)
                Text(vendor.credentialHelp).font(.footnote)
            }
            .padding()
            .frame(maxWidth: 300)
        }
    }

    private var isPasteEligible: Bool {
        if case .keyPair = vendor.credentialShape { return true }
        return false
    }

    @ViewBuilder
    private var credentialFields: some View {
        switch vendor.credentialShape {
        case .keyPair(let idLabel, let secretLabel):
            if isPasteMode {
                TextEditor(text: $pasteText)
                    .frame(height: 90)
                    .font(.system(.footnote, design: .monospaced))
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onChange(of: pasteText) { oldValue, newValue in
                        parsePaste(newValue)
                        if newValue.count > oldValue.count + 1 {
                            isPasteMode = false
                            pasteText = ""
                        }
                    }
                Text("access_key_id: …\nsecret_access_key: …")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                TextField(idLabel, text: $primaryField)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                SecureField(secretLabel, text: $secondaryField)
            }
        case .connectionString(let label):
            SecureField(label, text: $primaryField)
        case .jsonKey(let label):
            VStack(alignment: .leading) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $primaryField)
                    .frame(height: 100)
                    .font(.system(.footnote, design: .monospaced))
            }
        }
    }

    private func togglePasteMode() {
        isPasteMode.toggle()
        pasteText = ""
    }

    /// Liberal key:value / key=value parser — handles whitespace, trailing
    /// commas/quotes, "export " prefixes, and common id/secret spellings.
    /// Only overwrites a field the pasted block actually named.
    private func parsePaste(_ text: String) {
        let idKeys: Set<String> = ["accesskeyid", "awsaccesskeyid", "id", "accesskey", "key"]
        let secretKeys: Set<String> = ["secretaccesskey", "awssecretaccesskey", "secret", "secretkey"]

        for rawLine in text.split(whereSeparator: \.isNewline) {
            var line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("export ") { line.removeFirst("export ".count) }
            guard let separatorIndex = line.firstIndex(where: { $0 == ":" || $0 == "=" }) else { continue }

            let rawKey = line[line.startIndex..<separatorIndex]
            var value = line[line.index(after: separatorIndex)...].trimmingCharacters(in: .whitespaces)
            if value.hasSuffix(",") { value.removeLast() }
            value = value.trimmingCharacters(in: CharacterSet(charactersIn: "\"' "))
            guard !value.isEmpty else { continue }

            let key = rawKey.lowercased().filter(\.isLetter)
            if idKeys.contains(key) {
                primaryField = value
            } else if secretKeys.contains(key) {
                secondaryField = value
            }
        }
    }

    private var canSubmit: Bool {
        switch vendor.credentialShape {
        case .keyPair:
            return !primaryField.isEmpty && !secondaryField.isEmpty
        case .connectionString, .jsonKey:
            return !primaryField.isEmpty
        }
    }

    private var credential: StoredCredential {
        switch vendor.credentialShape {
        case .keyPair:
            return .keyPair(id: primaryField, secret: secondaryField)
        case .connectionString, .jsonKey:
            return .single(primaryField)
        }
    }

    private func submit() {
        isSubmitting = true
        errorMessage = nil
        Task {
            do {
                try await test()
                let resolvedName = name.isEmpty ? "\(vendor.rawValue) account" : name
                store.addConnection(vendor: vendor, name: resolvedName, credential: credential)
                isSubmitting = false
                onAdded()
            } catch {
                isSubmitting = false
                errorMessage = error.localizedDescription
            }
        }
    }

    /// Verifies the key is actually valid before it's saved. Uses STS GetCallerIdentity
    /// rather than a specific resource call (e.g. S3 ListBuckets) so a key scoped to only
    /// EC2/Lambda/etc. still passes — it doesn't assume S3 access.
    private func test() async throws {
        guard vendor == .aws, case .keyPair(let id, let secret) = credential else { return }
        let sigCredential = AWSSigV4Signer.Credential(accessKeyID: id, secretAccessKey: secret)
        try await STSClient.validate(credential: sigCredential)
    }
}
