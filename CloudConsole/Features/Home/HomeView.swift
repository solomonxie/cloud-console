import SwiftUI

struct HomeView: View {
    @StateObject private var store = HomeStore()
    @State private var showingAddCloud = false

    var body: some View {
        NavigationStack {
            Group {
                if store.connections.isEmpty {
                    emptyState
                } else {
                    connectionList
                }
            }
            .navigationTitle("Cloud Console")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingAddCloud = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddCloud) {
                AddCloudView(store: store)
            }
        }
    }

    private var connectionList: some View {
        List {
            ForEach(CloudVendor.allCases) { vendor in
                let items = store.connections(for: vendor)
                if !items.isEmpty {
                    Section(vendor.rawValue) {
                        ForEach(items) { connection in
                            NavigationLink {
                                ConnectionDetailView(store: store, connection: connection)
                            } label: {
                                ConnectionRow(connection: connection)
                            }
                        }
                        .onDelete { offsets in
                            for index in offsets { store.removeConnection(items[index]) }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No connections yet", systemImage: "cloud")
        } description: {
            Text("Add a cloud account with an access key — this app only does what that key can do.")
        } actions: {
            Button {
                showingAddCloud = true
            } label: {
                Label("Add connection", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
        }
    }
}

struct ConnectionRow: View {
    let connection: CloudConnection
    private static let dateStyle: Date.FormatStyle = .dateTime.month(.abbreviated).day()

    var body: some View {
        HStack(spacing: 12) {
            VendorBadge(systemImage: connection.vendor.icon, color: connection.vendor.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(connection.name)
                    .lineLimit(1)
                Text("\(connection.vendor.rawValue) · added \(connection.addedAt.formatted(Self.dateStyle))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

/// One connection = one cloud account; every resource kind for that
/// account lives on this same page, switched by the picker — not a
/// separate push per resource.
struct ConnectionDetailView: View {
    @ObservedObject var store: HomeStore
    let connection: CloudConnection
    @State private var selectedKind: ResourceKind?

    var body: some View {
        Group {
            if connection.vendor.resourceKinds.isEmpty {
                ContentUnavailableView("Coming soon", systemImage: "hourglass", description: Text("\(connection.vendor.rawValue) support isn't built yet."))
            } else {
                VStack(spacing: 0) {
                    if connection.vendor.resourceKinds.count > 1 {
                        Picker("Resource", selection: $selectedKind) {
                            ForEach(connection.vendor.resourceKinds) { kind in
                                Text(kind.shortLabel).tag(Optional(kind))
                            }
                        }
                        .pickerStyle(.segmented)
                        .padding()
                    }
                    if let selectedKind {
                        resourceContent(selectedKind)
                    }
                }
            }
        }
        .navigationTitle(connection.name)
        .navigationBarTitleDisplayMode(.large)
        .onAppear {
            if selectedKind == nil {
                selectedKind = connection.vendor.resourceKinds.first
            }
        }
    }

    @ViewBuilder
    private func resourceContent(_ kind: ResourceKind) -> some View {
        switch kind {
        case .s3:
            BucketsListView(store: store, connection: connection)
        default:
            ContentUnavailableView(kind.rawValue, systemImage: kind.icon, description: Text("Coming soon."))
        }
    }
}

#Preview {
    HomeView()
}
