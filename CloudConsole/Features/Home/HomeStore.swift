import Foundation

@MainActor
final class HomeStore: ObservableObject {
    private static let connectionsDefaultsKey = "connections.list"

    @Published var connections: [CloudConnection] = []

    init() {
        connections = Self.loadConnections()
    }

    func connections(for vendor: CloudVendor) -> [CloudConnection] {
        connections.filter { $0.vendor == vendor }
    }

    func credential(for connection: CloudConnection) -> StoredCredential? {
        guard let raw = KeychainStore.load(forKey: KeychainStore.credentialKey(for: connection.id)) else { return nil }
        return try? JSONDecoder().decode(StoredCredential.self, from: Data(raw.utf8))
    }

    func addConnection(vendor: CloudVendor, name: String, credential: StoredCredential) {
        let connection = CloudConnection(vendor: vendor, name: name)
        guard let data = try? JSONEncoder().encode(credential), let raw = String(data: data, encoding: .utf8) else { return }
        KeychainStore.save(raw, forKey: KeychainStore.credentialKey(for: connection.id))
        connections.append(connection)
        persistConnections()
    }

    func removeConnection(_ connection: CloudConnection) {
        KeychainStore.delete(forKey: KeychainStore.credentialKey(for: connection.id))
        connections.removeAll { $0.id == connection.id }
        persistConnections()
    }

    private func persistConnections() {
        guard let data = try? JSONEncoder().encode(connections) else { return }
        UserDefaults.standard.set(data, forKey: Self.connectionsDefaultsKey)
    }

    private static func loadConnections() -> [CloudConnection] {
        guard let data = UserDefaults.standard.data(forKey: connectionsDefaultsKey) else { return [] }
        return (try? JSONDecoder().decode([CloudConnection].self, from: data)) ?? []
    }
}
