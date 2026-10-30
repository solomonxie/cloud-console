// Hands the destination picker's choice back to the screen that opened it
// (route params can't carry callbacks).
export interface DestinationChoice {
  bucket: string;
  region: string;
  prefix: string;
}

const pending = new Map<string, (choice: DestinationChoice) => void>();
let counter = 0;

export function awaitDestination(onPick: (choice: DestinationChoice) => void): string {
  const token = `dest-${++counter}`;
  pending.set(token, onPick);
  return token;
}

export function resolveDestination(token: string, choice: DestinationChoice): void {
  pending.get(token)?.(choice);
  pending.delete(token);
}
