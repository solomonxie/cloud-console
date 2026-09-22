import SwiftUI

@MainActor
final class EC2InstancesStore: ObservableObject, ExpandableResourceStore {
    @Published var items: [EC2Instance] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var visibleCount = 20

    private let credential: AWSSigV4Signer.Credential
    private let cacheKey: String

    init(credential: AWSSigV4Signer.Credential) {
        self.credential = credential
        self.cacheKey = "ec2-instances:\(credential.accessKeyID)"
    }

    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            items = try await cached(key: cacheKey, ttl: defaultResourceTTL, forceRefresh: forceRefresh) {
                try await EC2Client.listInstances(credential: credential)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

@MainActor
final class RDSInstancesStore: ObservableObject, ExpandableResourceStore {
    @Published var items: [RDSInstance] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var visibleCount = 20

    private let credential: AWSSigV4Signer.Credential
    private let cacheKey: String

    init(credential: AWSSigV4Signer.Credential) {
        self.credential = credential
        self.cacheKey = "rds-instances:\(credential.accessKeyID)"
    }

    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            items = try await cached(key: cacheKey, ttl: defaultResourceTTL, forceRefresh: forceRefresh) {
                try await RDSClient.listInstances(credential: credential)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

@MainActor
final class LambdaFunctionsStore: ObservableObject, ExpandableResourceStore {
    @Published var items: [LambdaFunctionSummary] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var visibleCount = 20

    private let credential: AWSSigV4Signer.Credential
    private let cacheKey: String

    init(credential: AWSSigV4Signer.Credential) {
        self.credential = credential
        self.cacheKey = "lambda-functions:\(credential.accessKeyID)"
    }

    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            items = try await cached(key: cacheKey, ttl: defaultResourceTTL, forceRefresh: forceRefresh) {
                try await LambdaClient.listFunctions(credential: credential)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct EC2InstanceRow: View {
    let instance: EC2Instance
    let connection: CloudConnection

    var body: some View {
        HStack(spacing: 12) {
            VendorBadge(systemImage: "server.rack", color: connection.vendor.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(instance.name?.isEmpty == false ? instance.name! : instance.instanceId).lineLimit(1)
                Text("\(instance.instanceType) · \(instance.state)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

struct RDSInstanceRow: View {
    let instance: RDSInstance
    let connection: CloudConnection

    var body: some View {
        HStack(spacing: 12) {
            VendorBadge(systemImage: "cylinder.split.1x2.fill", color: connection.vendor.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(instance.identifier).lineLimit(1)
                Text("\(instance.engine) · \(instance.status)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

struct LambdaFunctionRow: View {
    let function: LambdaFunctionSummary
    let connection: CloudConnection

    var body: some View {
        HStack(spacing: 12) {
            VendorBadge(systemImage: "bolt.fill", color: connection.vendor.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(function.name).lineLimit(1)
                if let runtime = function.runtime {
                    Text(runtime)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

extension EC2Instance {
    var detailFields: [DetailField] {
        [
            DetailField(label: "Instance ID", value: instanceId),
            DetailField(label: "Type", value: instanceType),
            DetailField(label: "State", value: state),
            DetailField(label: "Name", value: name ?? "—"),
            DetailField(label: "Launched", value: launchTime?.formatted(date: .abbreviated, time: .shortened) ?? "—"),
        ]
    }
}

extension RDSInstance {
    var detailFields: [DetailField] {
        [
            DetailField(label: "Identifier", value: identifier),
            DetailField(label: "Engine", value: engine),
            DetailField(label: "Status", value: status),
            DetailField(label: "Class", value: instanceClass),
            DetailField(label: "Endpoint", value: endpointAddress ?? "—"),
        ]
    }
}

extension LambdaFunctionSummary {
    var detailFields: [DetailField] {
        [
            DetailField(label: "Function", value: name),
            DetailField(label: "Runtime", value: runtime ?? "—"),
            DetailField(label: "Memory", value: memorySize.map { "\($0) MB" } ?? "—"),
            DetailField(label: "Last modified", value: lastModified ?? "—"),
        ]
    }
}
