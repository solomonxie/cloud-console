import Foundation

struct EC2Instance: Identifiable, Hashable, Codable {
    var id: String { instanceId }
    let instanceId: String
    let instanceType: String
    let state: String
    let name: String?
    let launchTime: Date?
}

/// AWS EC2 — Query API (XML), same shape as IAM's, but region-specific. The app has no
/// region picker yet, so this only sees `region`'s instances (default us-east-1).
enum EC2Client {
    static func listInstances(region: String = "us-east-1", credential: AWSSigV4Signer.Credential) async throws -> [EC2Instance] {
        var components = URLComponents(string: "https://ec2.\(region).amazonaws.com/")!
        components.queryItems = [
            URLQueryItem(name: "Action", value: "DescribeInstances"),
            URLQueryItem(name: "Version", value: "2016-11-15"),
        ]
        let url = components.url!
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "GET"
        let headers = AWSSigV4Signer.headers(method: "GET", url: url, region: region, service: "ec2", credential: credential)
        for (key, value) in headers {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else { return [] }
        guard (200...299).contains(http.statusCode) else {
            throw AWSQueryError.parse(status: http.statusCode, data: data)
        }
        return parseInstances(data)
    }

    private static func parseInstances(_ data: Data) -> [EC2Instance] {
        let parser = XMLPathParser(data: data)
        var instances: [EC2Instance] = []
        var instanceId: String?
        var instanceType: String?
        var state: String?
        var name: String?
        var launchTime: String?
        var currentTagKey: String?

        parser.onEnd = { path, text in
            switch path.last {
            case "instanceId":
                instanceId = text
            case "instanceType":
                instanceType = text
            case "name" where path.dropLast().last == "instanceState":
                state = text
            case "launchTime":
                launchTime = text
            case "key" where path.dropLast().last == "item" && path.dropLast(2).last == "tagSet":
                currentTagKey = text
            case "value" where path.dropLast().last == "item" && path.dropLast(2).last == "tagSet":
                if currentTagKey == "Name" { name = text }
                currentTagKey = nil
            case "item" where path.dropLast().last == "instancesSet":
                if let id = instanceId {
                    instances.append(EC2Instance(instanceId: id, instanceType: instanceType ?? "", state: state ?? "", name: name, launchTime: launchTime.flatMap(AWSDate.iso8601)))
                }
                instanceId = nil
                instanceType = nil
                state = nil
                name = nil
                launchTime = nil
            default:
                break
            }
        }
        parser.run()
        return instances
    }
}
