import { LANGUAGES, type Locale } from "./i18n.ts";
type Translations = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const words = {
  winnings: [
    "Winnings",
    "Premios",
    "Prêmios",
    "Gains",
    "Gewinne",
    "奖金",
    "賞金",
    "당첨금",
  ],
  prizes: [
    "Ticket prizes",
    "Premios de boletos",
    "Prêmios dos bilhetes",
    "Gains des billets",
    "Losgewinne",
    "彩票奖金",
    "チケット賞金",
    "티켓 당첨금",
  ],
  recovery: [
    "Refunds & unused funds",
    "Reembolsos y fondos sin usar",
    "Reembolsos e saldo não usado",
    "Remboursements et fonds inutilisés",
    "Erstattungen und Restguthaben",
    "退款与未使用资金",
    "払い戻し・未使用残高",
    "환불 및 미사용 자금",
  ],
  activity: [
    "Claim activity",
    "Actividad de cobros",
    "Histórico de resgates",
    "Historique des demandes",
    "Auszahlungsaktivität",
    "领奖记录",
    "受取履歴",
    "청구 내역",
  ],
  claimById: [
    "Claim by ticket ID",
    "Reclamar por ID de boleto",
    "Resgatar por ID do bilhete",
    "Réclamer par identifiant de billet",
    "Mit Los-ID anfordern",
    "按彩票编号领奖",
    "チケットIDで請求",
    "티켓 ID로 청구",
  ],
} satisfies Record<string, Translations>;
export type RetailKey = keyof typeof words;
export const retailKeys = Object.keys(words) as RetailKey[];
export function retailCopy(locale: Locale) {
  const index = LANGUAGES.findIndex((l) => l.code === locale);
  return (key: RetailKey) => words[key][index];
}
