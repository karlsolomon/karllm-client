// src/global.d.ts
import "react";
declare module "react" {
    interface HTMLAttributes<T> {
        webkitdirectory?: boolean;
        mozdirectory?: boolean;
        directory?: boolean;
    }
}
