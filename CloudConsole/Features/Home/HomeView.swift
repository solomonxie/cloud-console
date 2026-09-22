import SwiftUI

struct HomeView: View {
    @StateObject private var store = HomeStore()
    @StateObject private var operationQueue = S3OperationQueue.shared
    @State private var showingAddCloud = false

    var body: some View {
        NavigationStack {
            mainScroll
                .navigationTitle("Cloud Console")
            .navigationDestination(for: HomeRoute.self) { route in
                destinationView(for: route)
            }
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

    private var mainScroll: some View {
        ScrollView {
            LazyVStack(spacing: 20) {
                if store.connections.isEmpty {
                    emptyState
                        .frame(minHeight: 280)
                } else {
                    ForEach(store.connections) { connection in
                        ConnectionCard(store: store, connection: connection)
                    }
                }
                SettingsCard()
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
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

    /// Single resolver for every pushed screen — registered once on the NavigationStack,
    /// so each route is only ever built when it's actually navigated to.
    @ViewBuilder
    private func destinationView(for route: HomeRoute) -> some View {
        switch route {
        case .service(let connection, let kind):
            let credential = store.signerCredential(for: connection)
            switch kind {
            case .billing:
                switch connection.vendor {
                case .tencent:
                    BillingView(
                        cacheKey: credential.accessKeyID,
                        load: { try await TencentBillingClient.monthToDateCost(credential: credential) },
                        loadHistory: { try await TencentBillingClient.monthlyBills(monthsBack: 11, credential: credential) }
                    )
                default:
                    BillingView(
                        cacheKey: credential.accessKeyID,
                        load: { try await CostExplorerClient.monthToDateCost(credential: credential) },
                        loadHistory: { try await CostExplorerClient.monthlyBills(monthsBack: 11, credential: credential) }
                    )
                }
            case .s3:
                ResourceListPage(
                    kind: kind, store: BucketsStore(credential: credential),
                    row: { bucket in BucketRow(bucket: bucket, connection: connection) },
                    route: { bucket in .bucketObjects(connectionID: connection.id, service: .s3, bucketName: bucket.name, region: bucket.region ?? "us-east-1", prefix: "", credential: credential) }
                )
            case .cos:
                ResourceListPage(
                    kind: kind, store: COSBucketsStore(credential: credential),
                    row: { bucket in BucketRow(bucket: bucket, connection: connection) },
                    route: { bucket in .bucketObjects(connectionID: connection.id, service: .cos, bucketName: bucket.name, region: bucket.region ?? "", prefix: "", credential: credential) }
                )
            case .iamUsers:
                ResourceListPage(
                    kind: kind, store: IAMUsersStore(credential: credential),
                    row: { user in IAMUserRow(user: user, connection: connection) },
                    route: { user in .iamUser(user: user, credential: credential) }
                )
            case .iamRoles:
                ResourceListPage(
                    kind: kind, store: IAMRolesStore(credential: credential),
                    row: { role in IAMRoleRow(role: role, connection: connection) },
                    route: { role in .iamRole(role: role, credential: credential) }
                )
            case .camUsers:
                ResourceListPage(
                    kind: kind, store: TencentCAMUsersStore(credential: credential),
                    row: { user in IAMUserRow(user: user, connection: connection) },
                    route: { user in .camUser(user: user, credential: credential) }
                )
            case .camRoles:
                ResourceListPage(
                    kind: kind, store: TencentCAMRolesStore(credential: credential),
                    row: { role in IAMRoleRow(role: role, connection: connection) },
                    route: { role in .camRole(role: role, credential: credential) }
                )
            case .ec2:
                ResourceListPage(
                    kind: kind, store: EC2InstancesStore(credential: credential),
                    row: { instance in EC2InstanceRow(instance: instance, connection: connection) },
                    route: { instance in .genericDetail(title: instance.instanceId, fields: instance.detailFields) }
                )
            case .rds:
                ResourceListPage(
                    kind: kind, store: RDSInstancesStore(credential: credential),
                    row: { instance in RDSInstanceRow(instance: instance, connection: connection) },
                    route: { instance in .genericDetail(title: instance.identifier, fields: instance.detailFields) }
                )
            case .lambda:
                ResourceListPage(
                    kind: kind, store: LambdaFunctionsStore(credential: credential),
                    row: { function in LambdaFunctionRow(function: function, connection: connection) },
                    route: { function in .genericDetail(title: function.name, fields: function.detailFields) }
                )
            case .cvm:
                ResourceListPage(
                    kind: kind, store: TencentCVMStore(credential: credential),
                    row: { instance in TencentCVMRow(instance: instance, connection: connection) },
                    route: { instance in .genericDetail(title: instance.instanceName.isEmpty ? instance.instanceId : instance.instanceName, fields: instance.detailFields) }
                )
            case .cdb:
                ResourceListPage(
                    kind: kind, store: TencentCDBStore(credential: credential),
                    row: { instance in TencentCDBRow(instance: instance, connection: connection) },
                    route: { instance in .genericDetail(title: instance.instanceName.isEmpty ? instance.instanceId : instance.instanceName, fields: instance.detailFields) }
                )
            case .scf:
                ResourceListPage(
                    kind: kind, store: TencentSCFStore(credential: credential),
                    row: { function in TencentSCFRow(function: function, connection: connection) },
                    route: { function in .genericDetail(title: function.functionName, fields: function.detailFields) }
                )
            case .eventBridge, .cloudWatchAlarms, .tencentEventBridge, .monitorAlarms:
                // Not implemented yet — ServiceRow gates these behind "Coming soon" and
                // never constructs a NavigationLink to this route, so this is unreachable.
                EmptyView()
            }
        case .bucketObjects(let connectionID, let service, let bucketName, let region, let prefix, let credential):
            BucketObjectsView(connectionID: connectionID, service: service, bucketName: bucketName, region: region, credential: credential, prefix: prefix)
        case .iamUser(let user, let credential):
            IAMUserDetailView(user: user, credential: credential)
        case .iamRole(let role, let credential):
            IAMRoleDetailView(role: role, credential: credential)
        case .camUser(let user, let credential):
            TencentCAMUserDetailView(user: user, credential: credential)
        case .camRole(let role, let credential):
            TencentCAMRoleDetailView(role: role, credential: credential)
        case .genericDetail(let title, let fields):
            KeyValueDetailView(title: title, fields: fields)
        case .operations:
            S3OperationsView(queue: operationQueue)
        }
    }
}

/// A connection rendered as a floating card — header identity up top, its services
/// as rows underneath, separated by hairlines within the same card.
private struct ConnectionCard: View {
    @ObservedObject var store: HomeStore
    let connection: CloudConnection
    @State private var showingRemoveConfirm = false
    private static let dateStyle: Date.FormatStyle = .dateTime.month(.abbreviated).day()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ForEach(connection.vendor.resourceKinds) { kind in
                Divider().padding(.leading, 68)
                ServiceRow(connection: connection, kind: kind)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
        .shadow(color: .black.opacity(0.08), radius: 12, x: 0, y: 6)
        .confirmationDialog("Remove \(connection.name)?", isPresented: $showingRemoveConfirm, titleVisibility: .visible) {
            Button("Remove", role: .destructive) { store.removeConnection(connection) }
        }
    }

    private var header: some View {
        HStack(spacing: 14) {
            VendorBadge(systemImage: connection.vendor.icon, color: connection.vendor.accentColor, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(connection.name)
                    .font(.title3.weight(.bold))
                Text("\(connection.vendor.rawValue) · added \(connection.addedAt.formatted(Self.dateStyle))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Menu {
                Button(role: .destructive) {
                    showingRemoveConfirm = true
                } label: {
                    Label("Remove connection", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(16)
    }
}

/// One service under a connection. Implemented kinds push to their resource list;
/// others show "coming soon".
private struct ServiceRow: View {
    let connection: CloudConnection
    let kind: ResourceKind

    var body: some View {
        if !kind.isImplemented {
            HStack(spacing: 14) {
                VendorBadge(systemImage: kind.icon, color: .gray, size: 34)
                Text(kind.rawValue)
                    .fontWeight(.medium)
                Spacer()
                Text("Coming soon")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .opacity(0.45)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        } else {
            NavigationLink(value: HomeRoute.service(connection: connection, kind: kind)) {
                HStack(spacing: 14) {
                    VendorBadge(systemImage: kind.icon, color: connection.vendor.accentColor, size: 34)
                    Text(kind.rawValue)
                        .fontWeight(.medium)
                        .foregroundStyle(.primary)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }
}

#Preview {
    HomeView()
}
