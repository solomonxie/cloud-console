import SwiftUI

/// Every pushable destination in the app, as a value — used with `navigationDestination(for:)`
/// so pushes are resolved lazily and exactly once, instead of the classic
/// `NavigationLink(destination:label:)` API's eager, repeated destination-closure evaluation
/// (which was silently resetting/never-appearing detail views).
enum HomeRoute: Hashable {
    case service(connection: CloudConnection, kind: ResourceKind)
    case bucketObjects(connectionID: UUID, service: StorageService, bucketName: String, region: String, prefix: String, credential: AWSSigV4Signer.Credential)
    case iamUser(user: IAMUser, credential: AWSSigV4Signer.Credential)
    case iamRole(role: IAMRole, credential: AWSSigV4Signer.Credential)
    case camUser(user: IAMUser, credential: AWSSigV4Signer.Credential)
    case camRole(role: IAMRole, credential: AWSSigV4Signer.Credential)
    /// A read-only key/value detail page — used by the newer, simpler resource kinds
    /// (EC2/Lambda/RDS, CVM/SCF/CDB) instead of a bespoke detail view each.
    case genericDetail(title: String, fields: [DetailField])
    case operations
}

struct DetailField: Hashable {
    let label: String
    let value: String
}

/// Backs a resource list page: loads its resources once, and reveals them a few
/// at a time via `visibleCount`.
@MainActor
protocol ExpandableResourceStore: ObservableObject {
    associatedtype Item: Identifiable
    var items: [Item] { get }
    var isLoading: Bool { get }
    var errorMessage: String? { get }
    var visibleCount: Int { get set }
    /// `forceRefresh` bypasses the cache (pull-to-refresh, or after an error) — otherwise a
    /// fresh-enough cached result loads instantly instead of waiting on the network.
    func load(forceRefresh: Bool) async
}

private let pageSize = 20

/// The page a service row pushes to: lists that service's resources, a page at a time,
/// and pushes further to a resource's own detail page on tap.
struct ResourceListPage<Store: ExpandableResourceStore, RowContent: View>: View {
    let kind: ResourceKind
    @StateObject private var store: Store
    let row: (Store.Item) -> RowContent
    let route: (Store.Item) -> HomeRoute

    init(kind: ResourceKind, store: Store,
         @ViewBuilder row: @escaping (Store.Item) -> RowContent,
         route: @escaping (Store.Item) -> HomeRoute) {
        self.kind = kind
        _store = StateObject(wrappedValue: store)
        self.row = row
        self.route = route
    }

    var body: some View {
        Group {
            if store.isLoading && store.items.isEmpty {
                ProgressView("Loading \(kind.rawValue.lowercased())…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage = store.errorMessage {
                ContentUnavailableView {
                    Label("Couldn't load \(kind.rawValue.lowercased())", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await store.load(forceRefresh: true) } }
                }
            } else if store.items.isEmpty {
                ContentUnavailableView(kind.rawValue, systemImage: kind.icon, description: Text("Nothing here yet."))
            } else {
                List {
                    ForEach(store.items.prefix(store.visibleCount)) { item in
                        NavigationLink(value: route(item)) {
                            row(item)
                        }
                    }
                    if store.items.count > store.visibleCount {
                        Button("Show more (\(store.items.count - store.visibleCount))") {
                            store.visibleCount += pageSize
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await store.load(forceRefresh: true) }
                .safeAreaInset(edge: .bottom) {
                    Text("\(store.items.count) item\(store.items.count == 1 ? "" : "s")")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity)
                        .background(.bar)
                }
            }
        }
        .navigationTitle(kind.rawValue)
        .task {
            if store.items.isEmpty { await store.load(forceRefresh: false) }
        }
    }
}
