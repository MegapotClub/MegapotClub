import {
  Asterisk,
  ExternalLink,
  Layers3,
  LockKeyhole,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import type { Messages } from "./i18n.ts";

const links = {
  megapot: { label: "Megapot", href: "https://megapot.io" },
  base: { label: "Base", href: "https://base.org" },
  ethereum: { label: "Ethereum", href: "https://ethereum.org" },
};

export function About({ messages: m }: { messages: Messages }) {
  return (
    <section className="subpage about-page">
      <div className="eyebrow">
        <Asterisk size={20} />
        {m.about}
      </div>
      <h1>{m.aboutHeading}</h1>
      <p className="page-description">
        {m.aboutDescription
          .split(/(\{(?:megapot|base|ethereum)\})/)
          .map((part, index) => {
            const link = links[part.slice(1, -1) as keyof typeof links];
            return link ? (
              <a
                className="about-external-link"
                key={index}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label}
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            ) : (
              part
            );
          })}
      </p>
      <div className="principles">
        <article className="principle-security">
          <ShieldCheck size={28} />
          <div>
            <h2>{m.verifiablySecure}</h2>
            <p>{m.verifiablySecureDetail}</p>
            <a
              className="source-code-link"
              href="about:blank"
              target="_blank"
              rel="noopener noreferrer"
            >
              {m.viewClubCode}
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          </div>
        </article>
        {(
          [
            {
              icon: ScanLine,
              title: "transparent",
              detail: "transparentDetail",
            },
            { icon: Layers3, title: "portable", detail: "portableDetail" },
            {
              icon: ShieldCheck,
              title: "openSource",
              detail: "openSourceDetail",
            },
            {
              icon: LockKeyhole,
              title: "privacyTitle",
              detail: "privacyDetail",
            },
          ] as const
        ).map((item) => (
          <article key={item.title}>
            <item.icon size={28} />
            <h2>{m[item.title]}</h2>
            <p>{m[item.detail]}</p>
          </article>
        ))}
      </div>
      <div className="about-links">
        <a
          className="button button-outline"
          href="https://docs.megapot.io"
          target="_blank"
          rel="noopener noreferrer"
        >
          {m.protocolDocs}
          <ExternalLink size={17} />
        </a>
      </div>
    </section>
  );
}
