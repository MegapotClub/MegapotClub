import { useState } from "react";
import type { AvatarComponent } from "@rainbow-me/rainbowkit";

/** ENS images may be external; image failures must leave a usable account control. */
export const WalletAvatar: AvatarComponent = ({ address, ensImage, size }) => {
  const [failed, setFailed] = useState<string>();
  const src =
    ensImage &&
    (/^https:\/\//i.test(ensImage) || /^data:image\//i.test(ensImage))
      ? ensImage
      : undefined;
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
        background: "#2448a0",
        color: "#fff",
        fontSize: Math.max(10, size / 3),
        fontWeight: 700,
      }}
    >
      {src && failed !== src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setFailed(src)}
        />
      ) : (
        address.slice(2, 4).toUpperCase()
      )}
    </span>
  );
};
