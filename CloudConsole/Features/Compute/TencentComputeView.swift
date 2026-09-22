import SwiftUI

@MainActor
final class TencentCVMStore: ObservableObject, ExpandableResourceStore {
    @Published var items: [TencentCVMInstance] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var visibleCount = 20

    private let credential: AWSSigV4Signer.Credential
    private let cacheKey: String

    init(credential: AWSSigV4Signer.Credential) {
        self.credential = credential
        self.cacheKey = "cvm-instances:\(credential.accessKeyID)"
    }

    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            items = try await cached(key: cacheKey, ttl: defaultResourceTTL, forceRefresh: forceRefresh) {
                try await TencentCVMClient.listInstances(credential: credential)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

@MainActor
final class TencentSCFStore: ObservableObject, ExpandableResourceStore {
    @Published var items: [TencentSCFFunction] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var visibleCount = 20

    private let credential: AWSSigV4Signer.Credential
    private let cacheKey: String

    init(credential: AWSSigV4Signer.Credential) {
        self.credential = credential
        self.cacheKey = "scf-functions:\(credential.accessKeyID)"
    }

    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            items = try await cached(key: cacheKey, ttl: defaultResourceTTL, forceRefresh: forceRefresh) {
                try await TencentSCFClient.listFunctions(credential: credential)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

@MainActor
final class TencentCDBStore: ObservableObject, ExpandableResourceStore {
    @Published var items: [TencentCDBInstance] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var visibleCount = 20

    private let credential: AWSSigV4Signer.Credential
    private let cacheKey: String

    init(credential: AWSSigV4Signer.Credential) {
        self.credential = credential
        self.cacheKey = "cdb-instances:\(credential.accessKeyID)"
    }

    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            items = try await cached(key: cacheKey, ttl: defaultResourceTTL, forceRefresh: forceRefresh) {
                try await TencentCDBClient.listInstances(credential: credential)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct TencentCVMRow: View {
    let instance: TencentCVMInstance
    let connection: CloudConnection

    var body: some View {
        HStack(spacing: 12) {
            VendorBadge(systemImage: "server.rack", color: connection.vendor.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(instance.instanceName.isEmpty ? instance.instanceId : instance.instanceName).lineLimit(1)
                Text("\(instance.instanceType) · \(instance.state)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

struct TencentSCFRow: View {
    let function: TencentSCFFunction
    let connection: CloudConnection

    var body: some View {
        HStack(spacing: 12) {
            VendorBadge(systemImage: "bolt.fill", color: connection.vendor.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(function.functionName).lineLimit(1)
                Text("\(function.runtime) · \(function.status)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

struct TencentCDBRow: View {
    let instance: TencentCDBInstance
    let connection: CloudConnection

    var body: some View {
        HStack(spacing: 12) {
            VendorBadge(systemImage: "cylinder.split.1x2.fill", color: connection.vendor.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(instance.instanceName.isEmpty ? instance.instanceId : instance.instanceName).lineLimit(1)
                if let engineVersion = instance.engineVersion {
                    Text(engineVersion)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

extension TencentCVMInstance {
    var detailFields: [DetailField] {
        [
            DetailField(label: "Instance ID", value: instanceId),
            DetailField(label: "Name", value: instanceName),
            DetailField(label: "Type", value: instanceType),
            DetailField(label: "State", value: state),
        ]
    }
}

extension TencentSCFFunction {
    var detailFields: [DetailField] {
        [
            DetailField(label: "Function", value: functionName),
            DetailField(label: "Runtime", value: runtime),
            DetailField(label: "Status", value: status),
        ]
    }
}

extension TencentCDBInstance {
    var detailFields: [DetailField] {
        [
            DetailField(label: "Instance ID", value: instanceId),
            DetailField(label: "Name", value: instanceName),
            DetailField(label: "Status code", value: String(statusCode)),
            DetailField(label: "Engine version", value: engineVersion ?? "—"),
        ]
    }
}
