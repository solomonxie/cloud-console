import Foundation

struct EC2Instance: Identifiable, Hashable, Codable {
    var id: String { instanceId }
    let instanceId: String
    let instanceType: String
    let state: String
    let name: String?
    let launchTime: Date?
}

struct EC2StatusChecks: Hashable {
    var system: String?
    var instance: String?
    var ebs: String?
}

/// AWS EC2 — Query API (XML), same shape as IAM's, but region-specific.
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

    /// System / instance / attached-EBS status checks (`ok`, `impaired`, `initializing`, …).
    static func statusChecks(instanceId: String, region: String, credential: AWSSigV4Signer.Credential) async throws -> EC2StatusChecks {
        if AppData.isDemo { return EC2StatusChecks(system: "ok", instance: "ok", ebs: "ok") }
        var components = URLComponents(string: "https://ec2.\(region).amazonaws.com/")!
        components.queryItems = [
            URLQueryItem(name: "Action", value: "DescribeInstanceStatus"),
            URLQueryItem(name: "Version", value: "2016-11-15"),
            URLQueryItem(name: "InstanceId.1", value: instanceId),
            URLQueryItem(name: "IncludeAllInstances", value: "true"),
        ]
        let url = components.url!
        var urlRequest = URLRequest(url: url)
        for (key, value) in AWSSigV4Signer.headers(method: "GET", url: url, region: region, service: "ec2", credential: credential) {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200...299).contains(status) else { throw AWSQueryError.parse(status: status, data: data) }
        let parser = XMLPathParser(data: data)
        var checks = EC2StatusChecks()
        parser.onEnd = { path, text in
            guard path.last == "status" else { return }
            switch path.dropLast().last {
            case "systemStatus": checks.system = text
            case "instanceStatus": checks.instance = text
            case "attachedEbsStatus": checks.ebs = text
            default: break
            }
        }
        parser.run()
        return checks
    }

    static func listRegions(credential: AWSSigV4Signer.Credential) async throws -> [String] {
        var components = URLComponents(string: "https://ec2.us-east-1.amazonaws.com/")!
        components.queryItems = [
            URLQueryItem(name: "Action", value: "DescribeRegions"),
            URLQueryItem(name: "Version", value: "2016-11-15"),
        ]
        let url = components.url!
        var urlRequest = URLRequest(url: url)
        for (key, value) in AWSSigV4Signer.headers(method: "GET", url: url, region: "us-east-1", service: "ec2", credential: credential) {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200...299).contains(status) else { throw AWSQueryError.parse(status: status, data: data) }
        let parser = XMLPathParser(data: data)
        var regions: [String] = []
        parser.onEnd = { path, text in
            if path.last == "regionName" { regions.append(text) }
        }
        parser.run()
        return regions
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
