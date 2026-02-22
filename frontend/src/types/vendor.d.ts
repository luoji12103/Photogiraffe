/**
 * Ambient type declarations for third-party packages that lack bundled TypeScript definitions.
 * This file must NOT contain top-level import/export statements
 * (it's a script-style declaration file, not a module).
 */

declare module "libraw-wasm" {
  interface LibRawMetadata {
    width?: number;
    height?: number;
    iwidth?: number;
    iheight?: number;
    make?: string;
    model?: string;
    iso_speed?: number;
    shutter?: number;
    aperture?: number;
    focal_len?: number;
    timestamp?: number;
    imgdata?: {
      sizes?: {
        width?: number;
        height?: number;
        iwidth?: number;
        iheight?: number;
      };
    };
    [key: string]: unknown;
  }

  interface LibRawImageData {
    data: Uint8Array;
    width: number;
    height: number;
    length?: number;
    [key: string]: unknown;
  }

  interface LibRawOpenOptions {
    bright?: number;
    threshold?: number;
    autoBrightThr?: number;
    halfSize?: boolean;
    useCameraWb?: boolean;
    useAutoWb?: boolean;
    useCameraMatrix?: number;
    outputColor?: number;
    outputBps?: number;
    userQual?: number;
    noAutoBright?: boolean;
    highlight?: number;
    [key: string]: unknown;
  }

  interface LibRawProcessor {
    open(data: Uint8Array, options?: LibRawOpenOptions): Promise<void>;
    metadata(fullOutput?: boolean): Promise<LibRawMetadata>;
    imageData(): Promise<LibRawImageData | Uint8Array>;
  }

  interface LibRawConstructor {
    new (): LibRawProcessor;
  }

  const LibRaw: LibRawConstructor;
  export default LibRaw;
}
