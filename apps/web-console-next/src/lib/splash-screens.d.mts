// Types for splash-screens.mjs (plain JavaScript so scripts/gen-icons.mjs can
// import it too). See that file for what each export is.

export interface IphoneScreen {
  /** CSS pixels, portrait. */
  width: number;
  height: number;
  /** Device pixel ratio. */
  ratio: number;
  /** The iPhones with this screen. */
  phones: string;
}

export declare const IPHONE_SCREENS: readonly IphoneScreen[];
export declare const SPLASH_ICON_CSS: number;
export declare function splashFile(screen: IphoneScreen): { src: string; width: number; height: number };
export declare function splashMedia(screen: IphoneScreen): string;
export declare function splashLinks(screens?: readonly IphoneScreen[]): { url: string; media: string }[];
