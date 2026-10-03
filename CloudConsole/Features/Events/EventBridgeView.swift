import SwiftUI

@MainActor
final class TencentEventBridgeStore: ObservableObject, ExpandableResourceStore {
    @Published var items: [EventBridgeItem] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var visibleCount = 20

    private let credential: AWSSigV4Signer.Credential
    private let cacheKey: String

    init(credential: AWSSigV4Signer.Credential) {
        self.credential = credential
        self.cacheKey = "tencent-eventbridge:\(credential.accessKeyID)"
    }

    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            items = try await cached(key: cacheKey, ttl: defaultResourceTTL, forceRefresh: forceRefresh) {
                try await TencentEventBridgeClient.listItems(credential: credential)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct EventBridgeRow: View {
    let item: EventBridgeItem
    let connection: CloudConnection
    var showRegion = false

    var body: some View {
        HStack(spacing: 12) {
            VendorBadge(systemImage: item.kind.icon, color: connection.vendor.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name).lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }

    private var subtitle: String {
        var parts = [item.kind.rawValue]
        if showRegion { parts.append(item.region) }
        if let state = item.state { parts.append(state.capitalized) }
        if let summary = item.summary, !summary.isEmpty { parts.append(summary) }
        return parts.joined(separator: " · ")
    }
}

struct EventBridgeDetailView: View {
    let item: EventBridgeItem
    let vendor: CloudVendor
    let credential: AWSSigV4Signer.Credential

    @State private var detail: EventBridgeDetail?
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let detail {
                Section("Details") {
                    ForEach(detail.fields, id: \.label) { DetailRow(field: $0) }
                }
                ForEach(detail.documents, id: \.title) { document in
                    Section {
                        Text(document.text)
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                    } header: {
                        Text(document.title)
                    }
                }
            } else if let errorMessage {
                Text(errorMessage).font(.caption).foregroundStyle(.secondary)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(item.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard detail == nil else { return }
            do {
                switch vendor {
                case .tencent: detail = try await TencentEventBridgeClient.detail(of: item, credential: credential)
                default: detail = try await EventBridgeClient.detail(of: item, credential: credential)
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
