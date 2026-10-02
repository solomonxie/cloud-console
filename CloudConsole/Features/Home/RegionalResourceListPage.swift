import SwiftUI

struct RegionResult<Item> {
    let region: String
    var items: [Item] = []
    var error: String?
}

/// Shows the last cached result per region right away, then rescans every enabled region one
/// at a time in the background, replacing each region as soon as it's done.
@MainActor
final class RegionalResourceStore<Item: Identifiable & Codable>: ObservableObject {
    @Published var results: [RegionResult<Item>] = []
    @Published var scanning: String?
    @Published var scanned = 0
    @Published var regionCount = 0

    private let cacheKind: String
    private let credential: AWSSigV4Signer.Credential
    private let fetch: (String) async throws -> [Item]
    private var scan: Task<Void, Never>?

    /// `cacheKind` is the cache key prefix; each region caches as `<kind>@<region>:<key id>`.
    init(cacheKind: String, credential: AWSSigV4Signer.Credential, fetch: @escaping (String) async throws -> [Item]) {
        self.cacheKind = cacheKind
        self.credential = credential
        self.fetch = fetch
    }

    var itemCount: Int { results.reduce(0) { $0 + $1.items.count } }
    var visibleResults: [RegionResult<Item>] { results.filter { !$0.items.isEmpty } }
    var failedResults: [RegionResult<Item>] { results.filter { $0.error != nil } }

    /// Without `forceRefresh`, regions fetched within the TTL aren't refetched.
    func load(forceRefresh: Bool = false) async {
        scan?.cancel()
        let task = Task { await run(forceRefresh: forceRefresh) }
        scan = task
        await task.value
    }

    private func key(_ region: String) -> String { "\(cacheKind)@\(region):\(credential.accessKeyID)" }

    private func run(forceRefresh: Bool) async {
        scanning = "regions"
        scanned = 0
        let regions = await AWSRegions.enabled(credential: credential, forceRefresh: forceRefresh)
        regionCount = regions.count
        if results.isEmpty {
            for region in regions {
                if let items = await staleValue([Item].self, key: key(region)) {
                    results.append(RegionResult(region: region, items: items))
                }
            }
        }
        for (index, region) in regions.enumerated() {
            guard !Task.isCancelled else { return }
            scanning = region
            scanned = index
            var result = RegionResult<Item>(region: region, items: results.first { $0.region == region }?.items ?? [])
            do {
                result.items = try await cached(key: key(region), ttl: defaultResourceTTL, forceRefresh: forceRefresh) {
                    try await fetch(region)
                }
            } catch {
                guard !Task.isCancelled else { return }
                result.error = error.localizedDescription
            }
            upsert(result, order: regions)
        }
        results.removeAll { !regions.contains($0.region) }
        scanning = nil
    }

    private func upsert(_ result: RegionResult<Item>, order: [String]) {
        if let index = results.firstIndex(where: { $0.region == result.region }) {
            results[index] = result
        } else {
            let position = order.firstIndex(of: result.region) ?? .max
            let insertAt = results.firstIndex { (order.firstIndex(of: $0.region) ?? .max) > position } ?? results.endIndex
            results.insert(result, at: insertAt)
        }
    }
}

/// Resources grouped by region; each region folds (open by default) and shows its count.
struct RegionalResourceListPage<Item: Identifiable & Codable, RowContent: View>: View {
    let kind: ResourceKind
    @StateObject private var store: RegionalResourceStore<Item>
    let row: (Item) -> RowContent
    let route: (Item, String) -> HomeRoute
    @State private var collapsed: Set<String> = []
    @State private var showingFailures = false

    init(kind: ResourceKind, store: RegionalResourceStore<Item>,
         @ViewBuilder row: @escaping (Item) -> RowContent,
         route: @escaping (Item, String) -> HomeRoute) {
        self.kind = kind
        _store = StateObject(wrappedValue: store)
        self.row = row
        self.route = route
    }

    var body: some View {
        Group {
            if store.scanning == nil && store.visibleResults.isEmpty && store.regionCount > 0 {
                ContentUnavailableView(kind.rawValue, systemImage: kind.icon, description: Text("Nothing in any of \(store.regionCount) regions."))
            } else {
                List {
                    ForEach(store.visibleResults, id: \.region) { result in
                        Section(isExpanded: expandedBinding(result.region)) {
                            ForEach(result.items) { item in
                                NavigationLink(value: route(item, result.region)) {
                                    row(item)
                                }
                            }
                        } header: {
                            RegionHeader(region: result.region, count: result.items.count)
                        }
                    }
                }
                .listStyle(.sidebar)
                .refreshable { await store.load(forceRefresh: true) }
            }
        }
        .safeAreaInset(edge: .bottom) { statusBar }
        .navigationTitle(kind.rawValue)
        .alert("Regions that failed", isPresented: $showingFailures) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(store.failedResults.map { "\($0.region): \($0.error ?? "")" }.joined(separator: "\n\n"))
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await store.load(forceRefresh: true) } } label: { Image(systemName: "arrow.clockwise") }
                    .disabled(store.scanning != nil)
            }
        }
        .task {
            if store.regionCount == 0 { await store.load() }
        }
    }

    private var statusBar: some View {
        HStack(spacing: 8) {
            if let scanning = store.scanning {
                ProgressView().controlSize(.small)
                Text(scanning == "regions" ? "Finding regions…" : "Scanning \(scanning) (\(store.scanned + 1)/\(store.regionCount))…")
            } else {
                Text("\(store.itemCount) item\(store.itemCount == 1 ? "" : "s") · \(store.regionCount) regions")
            }
            if !store.failedResults.isEmpty {
                Button {
                    showingFailures = true
                } label: {
                    Label("\(store.failedResults.count) failed", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity)
        .background(.bar)
    }

    private func expandedBinding(_ region: String) -> Binding<Bool> {
        Binding(
            get: { !collapsed.contains(region) },
            set: { isOn in
                if isOn { collapsed.remove(region) } else { collapsed.insert(region) }
            }
        )
    }
}

private struct RegionHeader: View {
    let region: String
    let count: Int

    var body: some View {
        HStack(spacing: 6) {
            Text(region)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
            if let name = AWSRegions.names[region] {
                Text(name)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text("\(count)")
                .font(.caption.weight(.semibold).monospacedDigit())
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(Capsule().fill(Color(.tertiarySystemFill)))
        }
        .textCase(nil)
    }
}
