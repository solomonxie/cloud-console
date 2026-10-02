import Foundation

/// The account's enabled regions, in display order.
enum AWSRegions {
    /// Enabled by default on every account, used when `DescribeRegions` isn't allowed.
    static let defaults = [
        "us-east-1", "us-east-2", "us-west-1", "us-west-2", "ca-central-1", "sa-east-1",
        "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-north-1",
        "ap-south-1", "ap-northeast-1", "ap-northeast-2", "ap-northeast-3", "ap-southeast-1", "ap-southeast-2",
    ]

    static let names: [String: String] = [
        "us-east-1": "N. Virginia", "us-east-2": "Ohio", "us-west-1": "N. California", "us-west-2": "Oregon",
        "ca-central-1": "Canada Central", "ca-west-1": "Calgary", "sa-east-1": "São Paulo", "mx-central-1": "Mexico",
        "eu-west-1": "Ireland", "eu-west-2": "London", "eu-west-3": "Paris", "eu-central-1": "Frankfurt",
        "eu-central-2": "Zurich", "eu-north-1": "Stockholm", "eu-south-1": "Milan", "eu-south-2": "Spain",
        "ap-south-1": "Mumbai", "ap-south-2": "Hyderabad", "ap-northeast-1": "Tokyo", "ap-northeast-2": "Seoul",
        "ap-northeast-3": "Osaka", "ap-southeast-1": "Singapore", "ap-southeast-2": "Sydney", "ap-southeast-3": "Jakarta",
        "ap-southeast-4": "Melbourne", "ap-southeast-5": "Malaysia", "ap-southeast-7": "Thailand", "ap-east-1": "Hong Kong",
        "me-south-1": "Bahrain", "me-central-1": "UAE", "il-central-1": "Tel Aviv", "af-south-1": "Cape Town",
    ]

    static func enabled(credential: AWSSigV4Signer.Credential, forceRefresh: Bool = false) async -> [String] {
        let regions = (try? await cached(key: "aws-regions:\(credential.accessKeyID)", ttl: 86400, forceRefresh: forceRefresh) {
            try await EC2Client.listRegions(credential: credential)
        }) ?? defaults
        return sorted(regions.isEmpty ? defaults : regions)
    }

    /// Scanned first: us-east-1, us-west-1, every Canada region, then the rest.
    static func sorted(_ regions: [String]) -> [String] {
        func rank(_ region: String) -> (Int, Int, String) {
            switch region {
            case "us-east-1": return (0, 0, region)
            case "us-west-1": return (1, 0, region)
            case _ where region.hasPrefix("ca-"): return (2, 0, region)
            default: return (3, defaults.firstIndex(of: region) ?? .max, region)
            }
        }
        return regions.sorted { rank($0) < rank($1) }
    }
}
