// The account's enabled regions, in display/scan order.

/** Enabled by default on every account, used when `DescribeRegions` isn't allowed. */
export const DEFAULT_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2", "ca-central-1", "sa-east-1",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-north-1",
  "ap-south-1", "ap-northeast-1", "ap-northeast-2", "ap-northeast-3", "ap-southeast-1", "ap-southeast-2",
];

export const REGION_NAMES: Record<string, string> = {
  "us-east-1": "N. Virginia", "us-east-2": "Ohio", "us-west-1": "N. California", "us-west-2": "Oregon",
  "ca-central-1": "Canada Central", "ca-west-1": "Calgary", "sa-east-1": "São Paulo", "mx-central-1": "Mexico",
  "eu-west-1": "Ireland", "eu-west-2": "London", "eu-west-3": "Paris", "eu-central-1": "Frankfurt",
  "eu-central-2": "Zurich", "eu-north-1": "Stockholm", "eu-south-1": "Milan", "eu-south-2": "Spain",
  "ap-south-1": "Mumbai", "ap-south-2": "Hyderabad", "ap-northeast-1": "Tokyo", "ap-northeast-2": "Seoul",
  "ap-northeast-3": "Osaka", "ap-southeast-1": "Singapore", "ap-southeast-2": "Sydney", "ap-southeast-3": "Jakarta",
  "ap-southeast-4": "Melbourne", "ap-southeast-5": "Malaysia", "ap-southeast-7": "Thailand", "ap-east-1": "Hong Kong",
  "me-south-1": "Bahrain", "me-central-1": "UAE", "il-central-1": "Tel Aviv", "af-south-1": "Cape Town",
};

function rank(region: string): [number, number, string] {
  if (region === "us-east-1") return [0, 0, region];
  if (region === "us-west-1") return [1, 0, region];
  if (region.startsWith("ca-")) return [2, 0, region];
  const index = DEFAULT_REGIONS.indexOf(region);
  return [3, index < 0 ? Number.MAX_SAFE_INTEGER : index, region];
}

/** Scanned first: us-east-1, us-west-1, every Canada region, then the rest in default order. */
export function sortRegions(regions: string[]): string[] {
  return [...regions].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra[0] !== rb[0]) return ra[0] - rb[0];
    if (ra[1] !== rb[1]) return ra[1] - rb[1];
    return ra[2] < rb[2] ? -1 : ra[2] > rb[2] ? 1 : 0;
  });
}

/** `listed` is the DescribeRegions result, or undefined when that call failed. */
export function enabledRegions(listed: string[] | undefined): string[] {
  return sortRegions(listed && listed.length > 0 ? listed : DEFAULT_REGIONS);
}
