// Side panel entry: wire the static dialogs once, then start the stack
// navigator on Home (connections, any vendor → resource → detail).
import { homeScreen } from "../app/home.ts";
import { startNavigator } from "../app/navigator.ts";
import { initBucketBrowser } from "./bucket-screen.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

initBucketBrowser();
startNavigator(
  {
    backBtn: $<HTMLButtonElement>("navBackBtn"),
    brand: $("navBrand"),
    title: $("navTitle"),
    subtitle: $("navSubtitle"),
    actions: $("navActions"),
    host: $("screenHost"),
  },
  homeScreen
);
