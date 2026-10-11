import SwiftUI

struct SSMParameterRow: View {
    let parameter: SSMParameter
    let connection: CloudConnection

    var body: some View {
        HStack(spacing: 12) {
            VendorBadge(systemImage: parameter.isSecure ? "lock.fill" : "slider.horizontal.3", color: connection.vendor.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(parameter.name).lineLimit(1).truncationMode(.middle)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }

    private var subtitle: String {
        var parts = [parameter.type]
        if let version = parameter.version { parts.append("v\(version)") }
        if let description = parameter.description, !description.isEmpty { parts.append(description) }
        return parts.joined(separator: " · ")
    }
}

struct SSMParameterDetailView: View {
    let parameter: SSMParameter
    let credential: AWSSigV4Signer.Credential

    @State private var value: String?
    @State private var loading = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section("Value") {
                if let value {
                    Text(value.isEmpty ? " " : value)
                        .font(.system(.callout, design: .monospaced))
                        .textSelection(.enabled)
                } else if loading {
                    ProgressView()
                } else if parameter.isSecure {
                    Button("Reveal", systemImage: "eye") { Task { await fetch() } }
                }
                if let errorMessage {
                    Text(errorMessage).font(.caption).foregroundStyle(.secondary)
                }
            }
            Section("Details") {
                ForEach(parameter.detailFields, id: \.label) { DetailRow(field: $0) }
            }
        }
        .navigationTitle(parameter.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard !parameter.isSecure, value == nil else { return }
            await fetch()
        }
    }

    private func fetch() async {
        loading = true
        errorMessage = nil
        do {
            value = try await ParameterStoreClient.value(of: parameter, decrypt: parameter.isSecure, credential: credential)
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }
}
