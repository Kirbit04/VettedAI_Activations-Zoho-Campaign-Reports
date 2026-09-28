import { useCallback, useEffect, useMemo, useState } from "react";

const ZOHO_CONFIG = {
  TOKEN_URL: "/api/zoho-auth",
  API_BASE: "/api/zoho-api",
  CLIENT_ID: import.meta.env.VITE_ZOHO_CLIENT_ID || "",
  CLIENT_SECRET: import.meta.env.VITE_ZOHO_CLIENT_SECRET || "",
  REFRESH_TOKEN: import.meta.env.VITE_ZOHO_REFRESH_TOKEN || "",
  BEARER_TOKEN: import.meta.env.VITE_ZOHO_BEARER_TOKEN || "",
};

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  if (ZOHO_CONFIG.REFRESH_TOKEN) {
    const body = new URLSearchParams({
      client_id: ZOHO_CONFIG.CLIENT_ID,
      client_secret: ZOHO_CONFIG.CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: ZOHO_CONFIG.REFRESH_TOKEN,
    });
    const response = await fetch(ZOHO_CONFIG.TOKEN_URL, { method: "POST", body });
    const data = await response.json();
    if (data.access_token) {
      cachedToken = data.access_token;
      tokenExpiry = Date.now() + ((data.expires_in || 3600) - 60) * 1000;
      return cachedToken;
    }
  }
  return ZOHO_CONFIG.BEARER_TOKEN;
}

async function zohoFetch(path, params = {}) {
  const token = await getAccessToken();
  const url = new URL(`${ZOHO_CONFIG.API_BASE}${path}`, window.location.origin);
  url.searchParams.set("resfmt", "JSON");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  if (!response.ok) throw new Error(`Zoho API ${response.status}: ${response.statusText}`);
  return response.json();
}

const numberValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const count = (value) => numberValue(value) === null ? "—" : numberValue(value).toLocaleString();
const derivedRate = (value, denominator) => denominator > 0 ? `${((value / denominator) * 100).toFixed(1)}%` : "—";
const firstValue = (...values) => values.find((value) => numberValue(value) !== null);
const firstField = (object, fields) => fields.map((field) => object?.[field]).find((value) => value !== undefined && value !== null && value !== "");

function normalizeContact(contact, campaignName) {
  const opens = numberValue(firstField(contact, ["open_count", "opens_count", "opens", "opened_count"])) || 0;
  const clicks = numberValue(firstField(contact, ["clickperopenrate", "clicks_count", "clicks"])) || 0;
  const replied = numberValue(firstField(contact, ["replied", "forward_count", "has_replied", "reply"]));
  const open_rate = numberValue(firstField(contact, ["open_percent", "openperemail", "openperrecipient"])) || 0;
  const unopened = numberValue(firstField(contact, ["unopened", "unopened_count", "not_opened"])) || 0;
  const bounced = numberValue(firstField(contact, ["bounced", "bounce_count"])) || 0;
  const unsubscribed = numberValue(firstField(contact, ["unsubscribed", "unsub_count"])) || 0;
  
  return {
    id: firstField(contact, ["contact_id", "contactkey", "id", "email"]) || Math.random(),
    name: firstField(contact, ["name", "contact_name", "full_name"]) || "Unnamed contact",
    email: firstField(contact, ["email", "email_address"]) || "—",
    company: firstField(contact, ["company", "company_name", "organization"]) || "—",
    jobTitle: firstField(contact, ["job_title", "jobtitle", "title"]) || "—",
    campaign: campaignName,
    deliveryStatus: firstField(contact, ["delivery_status", "status"]) || "Delivered",
    opens,
    clicks,
    replied,
    open_rate,
    unopened,
    bounced,
    unsubscribed,
    lastOpen: firstField(contact, ["last_open_time", "last_open", "opened_time"]),
    lastClick: firstField(contact, ["last_click_time", "last_click", "clicked_time"]),
    replyTimestamp: firstField(contact, ["reply_timestamp", "reply_time", "replied_time"]),
  };
}

function findContacts(value) {
  if (!value || typeof value !== "object") return [];
  const keys = ["contacts", "contact_data", "campaign_contacts", "campaign-contacts", "recipients", "members"];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return Object.values(value).reduce((found, child) => found.length ? found : findContacts(child), []);
}

function normalizeReport(data, campaign) {
  const stats = data?.["campaign-reports"]?.[0] || data?.stats || {};
  const reach = data?.["campaign-reach"]?.[0] || {};
  const details = data?.["campaign-details"]?.[0] || data?.details || {};
  const sent = numberValue(firstValue(stats.emails_sent_count, stats.sent_count, stats.total_sent)) || 0;
  const delivered = numberValue(firstValue(stats.delivered_count, stats.total_delivered)) || 0;
  const bounced = numberValue(firstValue(stats.bounces_count, stats.bounce_count)) ?? Math.max(0, sent - delivered);
  const uniqueOpens = numberValue(stats.opens_count) || 0;
  const clicks = numberValue(stats.unique_clicks_count);
  const contacts = findContacts(data).map((contact) => normalizeContact(contact, campaign.campaign_name));
  const contactReplies = contacts.filter((contact) => contact.replied).length;
  return {
    campaign: { ...campaign, ...details }, sent, delivered, bounced, uniqueOpens,
    hardBounces: numberValue(stats.hardbounce_count) || 0,
    softBounces: numberValue(stats.softbounce_count) || 0,
    unsubscribed: numberValue(stats.unsub_count) || 0,
    spam: numberValue(stats.spams_count) || 0,
    autoreplies: numberValue(stats.autoreply_count) || 0,
    clicks, clickRate: numberValue(stats.unique_clicked_percent),
    clickToOpenRate: numberValue(stats.clicksperopenrate),
    openRate: numberValue(stats.open_percent), deliveredRate: numberValue(stats.delivered_percent),
    unopened: numberValue(stats.unopened) || 0, unopenedRate: numberValue(stats.unopened_percent),
    bounceRate: numberValue(stats.bounce_percent), spamRate: numberValue(stats.spam_percent),
    unsubscribeRate: numberValue(stats.unsubscribe_percent), unsent: numberValue(stats.unsent_count) || 0,
    reach, locations: data?.["campaign-by-loaction"] || {},
    multipleOpens: contacts.filter((contact) => contact.opens > 1).length,
    replies: contacts.length ? contactReplies : null, replyRate: numberValue(stats.forward_count), contacts,
  };
}

function KpiCard({ label, value, sub, tone = "" }) {
  return <article className={`kpi-card ${tone}`}><p className="kpi-label">{label}</p><strong>{value}</strong>{sub && <span>{sub}</span>}</article>;
}

function FunnelStage({ label, value, detail, tone = "orange" }) {
  return <div className={`funnel-stage funnel-stage--${tone}`}><span>{label}</span><strong>{count(value)}</strong><small>{detail}</small></div>;
}

function ContactTable({ contacts, segment }) {
  const columns = segment === "unopened" ? ["Name", "Email", "Company", "Opens", "Clicks", "Reply"] : segment === "multiple" ? ["Name", "Email", "Company", "Opens", "Last open", "Intent"] : segment === "clicked" ? ["Name", "Email", "Company", "Clicks", "Last click", "Reply"] : ["Name", "Email", "Company", "Reply status", "Reply time"];
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{contacts.map((contact) => <tr key={contact.id}><td><strong>{contact.name}</strong><small>{contact.jobTitle}</small></td><td>{contact.email}</td><td>{contact.company}</td>{segment === "unopened" && <><td>{contact.opens}</td><td>{contact.clicks ? "Clicked" : "—"}</td><td>{contact.replied ? "Replied" : "—"}</td></>}{segment === "multiple" && <><td>{contact.opens}</td><td>{contact.lastOpen || "—"}</td><td>{contact.replied ? "Replied" : contact.clicks ? "Clicked" : "Opened"}</td></>}{segment === "clicked" && <><td>{contact.clicks}</td><td>{contact.lastClick || "—"}</td><td>{contact.replied ? "Replied" : "No reply"}</td></>}{segment === "replied" && <><td>Replied</td><td>{contact.replyTimestamp || "—"}</td></>}</tr>)}</tbody></table></div>;
}

export default function ZohoCampaignsDashboard() {
  const [campaigns, setCampaigns] = useState([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState("");
  const [segment, setSegment] = useState("unopened");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("activity");

  const loadCampaigns = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const data = await zohoFetch("/recentcampaigns");
      const list = data?.recent_campaigns || data?.list || data?.list_of_campaigns || (Array.isArray(data) ? data : []);
      const sent = list.filter((campaign) => (campaign.campaign_status || "").toLowerCase() !== "draft");
      setCampaigns(sent); setSelectedKey((current) => current || sent[0]?.campaign_key || "");
      if (!sent.length) setError("No sent campaigns found.");
    } catch (requestError) { setError(requestError.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);
  useEffect(() => {
    if (!selectedKey) { setReport(null); return undefined; }
    let cancelled = false;
    setReportLoading(true); setError("");
    const campaign = campaigns.find((item) => item.campaign_key === selectedKey) || {};
    zohoFetch("/campaignreports", { campaignkey: selectedKey })
      .then((data) => { if (!cancelled) setReport(normalizeReport(data, campaign)); })
      .catch((requestError) => { if (!cancelled) { setReport(null); setError(requestError.message); } })
      .finally(() => { if (!cancelled) setReportLoading(false); });
    return () => { cancelled = true; };
  }, [selectedKey, campaigns]);

  const metrics = useMemo(() => {
    if (!report) return null;
    const delivered = report.delivered;
    return { ...report, bounceRate: report.bounceRate ?? derivedRate(report.bounced, report.sent), replyRate: report.replyRate ?? (report.replies === null ? null : derivedRate(report.replies, delivered)), engaged: Math.min(delivered, report.uniqueOpens) };
  }, [report]);

  const filteredContacts = useMemo(() => {
    if (!metrics) return [];
    const query = search.toLowerCase();
    const matches = metrics.contacts.filter((contact) => [contact.name, contact.email, contact.company].some((field) => field.toLowerCase().includes(query)));
    const groups = { unopened: matches.filter((contact) => contact.opens === 0 && contact.deliveryStatus.toLowerCase() !== "bounced"), multiple: matches.filter((contact) => contact.opens > 1).sort((a, b) => b.opens - a.opens), clicked: matches.filter((contact) => contact.clicks > 0), replied: matches.filter((contact) => contact.replied) };
    return groups[segment].sort((a, b) => sort === "opens" ? b.opens - a.opens : sort === "clicks" ? b.clicks - a.clicks : String(b.lastClick || b.lastOpen || b.replyTimestamp || "").localeCompare(String(a.lastClick || a.lastOpen || a.replyTimestamp || "")));
  }, [metrics, search, segment, sort]);

  const downloadCsv = () => {
    if (!filteredContacts.length) return;
    const headers = ["Name", "Email", "Company", "Job Title", "Campaign", "Open Count", "Click Count", "Reply Status", "Last Open", "Last Click"];
    const rows = filteredContacts.map((contact) => [contact.name, contact.email, contact.company, contact.jobTitle, contact.campaign, contact.opens, contact.clicks, contact.replied ? "Replied" : "No reply", contact.lastOpen || "", contact.lastClick || ""]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${metrics.campaign.campaign_name || "campaign"}-${segment}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  return <div className="zcd"><style>{styles}</style><style>{reportStyles}</style>
    <header className="dashboard-header"><div><p className="eyebrow">Campaign intelligence</p><h1>Performance <em>& follow-up</em></h1><p className="intro">Move from what happened to who needs a response next.</p></div><button className="refresh-button" onClick={loadCampaigns} disabled={loading}>{loading ? "Loading..." : "Refresh data"}</button></header>
    {error && <div className="error-banner">{error}</div>}
    <section className="selector-panel"><label htmlFor="campaign-select">Campaign</label><select id="campaign-select" value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)} disabled={loading || !campaigns.length}><option value="">Select campaign</option>{campaigns.map((campaign) => <option key={campaign.campaign_key} value={campaign.campaign_key}>{campaign.campaign_name}</option>)}</select>{metrics && <div className="campaign-meta"><strong>{metrics.campaign.campaign_name}</strong><span>{metrics.campaign.sent_date_string || metrics.campaign.sent_time || "Date not supplied"}</span><span>{count(metrics.sent)} audience</span><span>{metrics.campaign.campaign_status || "Sent"}</span></div>}</section>
    {reportLoading && <div className="loading-panel"><div className="loading-bar" /><div className="loading-grid">{[1, 2, 3, 4, 5].map((item) => <div className="skeleton" key={item} />)}</div></div>}
    {!reportLoading && !metrics && <div className="empty-panel">Select a campaign to view performance.</div>}
    {!reportLoading && metrics && <>
      <section className="kpi-section"><div className="section-heading"><div><p className="eyebrow">Performance overview</p><h2>Campaign pulse</h2></div><span>Values mirror the Zoho campaign-reports response</span></div><div className="kpi-grid"><KpiCard label="Emails sent" value={count(metrics.sent)} sub="emails_sent_count" tone="accent" /><KpiCard label="Delivered" value={count(metrics.delivered)} sub={`${metrics.deliveredRate ?? derivedRate(metrics.delivered, metrics.sent)}% · delivered_count`} /><KpiCard label="Bounces" value={count(metrics.bounced)} sub={`${metrics.bounceRate ?? "—"}% · ${count(metrics.hardBounces)} hard / ${count(metrics.softBounces)} soft`} tone="warning" /><KpiCard label="Unique opens" value={count(metrics.uniqueOpens)} sub={`${metrics.openRate ?? "—"}% · opens_count`} tone="accent" /><KpiCard label="Unopened" value={count(metrics.unopened)} sub={`${metrics.unopenedRate ?? "—"}% · unopened`} /><KpiCard label="Unique clicks" value={count(metrics.clicks)} sub={`${metrics.clickRate ?? "—"}% · unique_clicked_percent`} tone="accent" /><KpiCard label="Clicks per open" value={metrics.clickToOpenRate === null ? "—" : `${metrics.clickToOpenRate}%`} sub="clicksperopenrate" /><KpiCard label="REPLY COUNT" value={metrics.replyRate === null ? "—" : `${metrics.replyRate}%`} sub="forward_count" /><KpiCard label="Unsubscribed" value={count(metrics.unsubscribed)} sub={`${metrics.unsubscribeRate ?? "—"}% · unsub_count`} /><KpiCard label="Spam complaints" value={count(metrics.spam)} sub={`${metrics.spamRate ?? "—"}% · spams_count`} tone="warning" /><KpiCard label="Auto-replies" value={count(metrics.autoreplies)} sub="autoreply_count" /><KpiCard label="Unsent" value={count(metrics.unsent)} sub="unsent_count" /></div></section>
      <section className="report-grid"><article className="panel report-panel"><div className="section-heading"><div><p className="eyebrow">Campaign reach</p><h2>Audience activity</h2></div><span>campaign-reach</span></div><div className="reach-grid">{Object.entries(metrics.reach).map(([key, value]) => <div key={key}><span>{key}</span><strong>{count(value)}</strong></div>)}</div></article><article className="panel report-panel"><div className="section-heading"><div><p className="eyebrow">Geography</p><h2>Audience by location</h2></div><span>campaign-by-loaction</span></div><div className="location-list">{Object.entries(metrics.locations).sort(([, first], [, second]) => second - first).map(([key, value]) => <div key={key}><span>{key.toUpperCase()}</span><strong>{count(value)}</strong></div>)}</div></article></section>
      <section className="panel details-panel"><div className="section-heading"><div><p className="eyebrow">Campaign details</p><h2>{metrics.campaign.email_subject || metrics.campaign.campaign_name}</h2></div><span>{metrics.campaign.email_type || "Email campaign"}</span></div><div className="details-grid">{[["From", metrics.campaign.email_from], ["Reply to", metrics.campaign.reply_to], ["Created", metrics.campaign.created_time], ["Sent", metrics.campaign.sent_time], ["Format", metrics.campaign.email_options]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || "—"}</strong></div>)}</div></section>
    </>}
  </div>;
}

const styles = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
.zcd{--ink:#1c2630;--muted:#71808c;--line:#dfe6e8;--white:#fff;--orange:#d95d32;--plum:#76516d;--teal:#197b78;--gold:#b18336;color:var(--ink);font-family:'DM Sans',sans-serif;max-width:1440px;margin:auto}.zcd h1,.zcd h2{font-family:'Space Grotesk',sans-serif;margin:0}.dashboard-header{display:flex;justify-content:space-between;align-items:end;gap:1rem;margin-bottom:2rem}.eyebrow{color:var(--orange);font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin:0 0 .45rem}.dashboard-header h1{font-size:clamp(2rem,4vw,3.6rem);letter-spacing:-.04em}.dashboard-header h1 em{color:var(--orange);font-style:normal}.intro{color:var(--muted);margin:.6rem 0 0}.refresh-button,.download-button{background:var(--ink);border:0;color:#fff;padding:.7rem 1rem;border-radius:7px;font:600 .8rem 'DM Sans';cursor:pointer}.refresh-button:disabled,.download-button:disabled{opacity:.45;cursor:not-allowed}.selector-panel,.panel,.empty-panel,.loading-panel{background:var(--white);border:1px solid var(--line);border-radius:10px}.selector-panel{padding:1.1rem 1.25rem;display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem}.selector-panel label{font-weight:700;font-size:.8rem}.selector-panel select,.contact-tools select,.contact-tools input{border:1px solid var(--line);border-radius:6px;background:#fff;padding:.68rem .8rem;color:var(--ink);font:500 .84rem 'DM Sans'}.selector-panel select{min-width:280px}.campaign-meta{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;color:var(--muted);font-size:.76rem}.campaign-meta strong{color:var(--ink)}.campaign-meta span+span{border-left:1px solid var(--line);padding-left:1rem}.error-banner{background:#fff0ed;color:#a53c23;border:1px solid #f1c5ba;border-radius:7px;padding:.8rem 1rem;margin-bottom:1rem;font-size:.84rem}.section-heading{display:flex;justify-content:space-between;align-items:end;gap:1rem;margin-bottom:1rem}.section-heading h2{font-size:1.25rem}.section-heading>span{color:var(--muted);font-size:.75rem}.kpi-section{margin-bottom:1.25rem}.kpi-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:.7rem}.kpi-card{background:var(--white);border:1px solid var(--line);border-radius:8px;padding:.9rem;min-height:106px}.kpi-card.accent{border-top:3px solid var(--orange)}.kpi-card.warning{border-top:3px solid var(--gold)}.kpi-label{color:var(--muted);font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin:0 0 .55rem}.kpi-card strong{display:block;font:700 1.45rem 'Space Grotesk';letter-spacing:-.03em}.kpi-card span{display:block;color:var(--muted);font-size:.7rem;margin-top:.35rem}.analysis-grid{display:grid;grid-template-columns:2fr 1fr;gap:1.25rem;margin-bottom:1.25rem}.panel{padding:1.25rem}.funnel{display:grid;grid-template-columns:repeat(4,1fr);align-items:center;gap:.6rem}.funnel-stage{text-align:center;border-top:4px solid var(--orange);background:#fff8f5;border-radius:7px;padding:1rem .5rem}.funnel-stage--plum{border-color:var(--plum);background:#faf6f9}.funnel-stage--teal{border-color:var(--teal);background:#f2fbfa}.funnel-stage--gold{border-color:var(--gold);background:#fcf9f1}.funnel-stage span{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:var(--muted)}.funnel-stage strong{display:block;font:700 1.65rem 'Space Grotesk';margin:.35rem 0}.funnel-stage small{display:block;color:var(--muted);font-size:.68rem}.cta-branches{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:.8rem;position:relative;padding-top:.75rem}.cta-branches:before{content:'';position:absolute;top:0;left:25%;right:25%;border-top:1px dashed var(--line)}.delivery-panel h2{font-size:1.25rem;margin-bottom:1.2rem}.delivery-stat{display:flex;align-items:baseline;justify-content:space-between}.delivery-stat strong{font:700 2rem 'Space Grotesk'}.delivery-stat span{color:var(--muted);font-size:.78rem}.delivery-line{height:2rem;border-left:2px solid var(--orange);margin-left:1.15rem}.delivery-line--drop{border-color:var(--gold)}.bounce-callout{display:flex;justify-content:space-between;background:#fcf9f1;border-radius:7px;padding:.8rem;margin-top:1.1rem;font-size:.8rem}.bounce-callout strong{color:var(--gold)}.cta-panel{margin-bottom:1.25rem}.cta-bars{display:grid;gap:1rem}.cta-bars>div{display:grid;grid-template-columns:75px 1fr 45px 60px;align-items:center;gap:.8rem;font-size:.8rem}.cta-bars strong{font-family:'Space Grotesk'}.cta-bars small{color:var(--muted)}.bar{height:11px;background:#edf1f1;border-radius:2px;overflow:hidden}.bar i{display:block;height:100%;background:var(--teal);transition:width .45s ease}.bar--gold i{background:var(--gold)}.segment-tabs{display:flex;gap:.3rem;border-bottom:1px solid var(--line);margin-bottom:1rem;overflow:auto}.segment-tabs button{white-space:nowrap;border:0;background:none;padding:.65rem .8rem;color:var(--muted);font:600 .78rem 'DM Sans';cursor:pointer;border-bottom:2px solid transparent}.segment-tabs button.active{color:var(--orange);border-color:var(--orange)}.segment-tabs b{margin-left:.35rem;font-size:.68rem;background:#eef2f2;border-radius:99px;padding:.15rem .38rem}.contact-tools{display:flex;justify-content:space-between;gap:.8rem;margin-bottom:1rem}.contact-tools input{flex:1;max-width:420px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.78rem;min-width:720px}th{text-align:left;color:var(--muted);font-size:.67rem;text-transform:uppercase;letter-spacing:.06em;padding:.6rem;border-bottom:1px solid var(--line)}td{padding:.7rem .6rem;border-bottom:1px solid #edf1f1;white-space:nowrap}td strong{display:block}td small{display:block;color:var(--muted);font-size:.68rem;margin-top:.15rem}.download-button{margin-left:auto;background:var(--orange)}.empty-panel{text-align:center;color:var(--muted);padding:3rem 1rem;margin-bottom:1.25rem}.empty-panel.compact{border:0;padding:2rem}.loading-panel{padding:1.25rem;margin-bottom:1.25rem}.loading-bar{height:18px;width:35%;background:#e8eeee;border-radius:4px;margin-bottom:1.2rem}.loading-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:.7rem}.skeleton{height:90px;background:linear-gradient(90deg,#eef2f2,#fff,#eef2f2);background-size:200% 100%;animation:shimmer 1.2s infinite;border-radius:7px}@keyframes shimmer{to{background-position:-200% 0}}@media(max-width:1050px){.kpi-grid{grid-template-columns:repeat(4,1fr)}}@media(max-width:760px){.dashboard-header,.selector-panel{align-items:stretch;flex-direction:column}.selector-panel select{min-width:0}.campaign-meta span+span{border:0;padding:0}.kpi-grid{grid-template-columns:repeat(2,1fr)}.analysis-grid{grid-template-columns:1fr}.funnel{grid-template-columns:repeat(2,1fr)}.cta-branches{grid-column:1/-1}.cta-bars>div{grid-template-columns:60px 1fr 35px 48px}.section-heading{align-items:start;flex-direction:column}.download-button{margin:0}.contact-tools{flex-direction:column}.contact-tools input{max-width:none}}
`;

const reportStyles = `
.report-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1.25rem}.report-panel,.details-panel{padding:1.25rem}.reach-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.7rem}.reach-grid div,.location-list div,.details-grid div{display:flex;justify-content:space-between;align-items:center;gap:.75rem;border-bottom:1px solid var(--line);padding:.65rem 0}.reach-grid span,.location-list span,.details-grid span{color:var(--muted);font-size:.74rem;text-transform:capitalize}.reach-grid strong,.location-list strong,.details-grid strong{font-size:.85rem}.location-list{display:grid;grid-template-columns:repeat(3,1fr);column-gap:1rem}.details-panel{margin-top:1.25rem}.details-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:1rem}.details-grid div{display:block}.details-grid strong{display:block;margin-top:.35rem;overflow-wrap:anywhere}@media (max-width:800px){.report-grid{grid-template-columns:1fr}.details-grid{grid-template-columns:repeat(2,1fr)}}@media (max-width:520px){.reach-grid,.location-list{grid-template-columns:repeat(2,1fr)}.details-grid{grid-template-columns:1fr}.selector-panel{align-items:stretch;flex-direction:column}.selector-panel select{min-width:0}}
`;
