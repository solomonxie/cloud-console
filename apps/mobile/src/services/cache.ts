import AsyncStorage from "@react-native-async-storage/async-storage";
import { ResourceCache } from "@cloud-console/core/cache";

/** Resource listings only; demo mode never touches it. */
export const resourceCache = new ResourceCache(AsyncStorage);
