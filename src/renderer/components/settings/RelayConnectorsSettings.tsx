import React, { useState } from 'react';
import type { HarnessConfig } from '../../../shared/types';

interface Props {
  config: HarnessConfig;
  onUpdated: (config: HarnessConfig) => void;
}

interface ConnectorCardProps {
  title: string;
  description: string;
  enabled: boolean;
  children: React.ReactNode;
  onSave: () => Promise<void>;
  saving: boolean;
  saved: boolean;
}

function ConnectorCard({ title, description, enabled, children, onSave, saving, saved }: ConnectorCardProps) {
  const [open, setOpen] = useState(enabled);

  return (
    <div className="border border-[--border] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[--bg-overlay] hover:bg-[--bg-hover] transition-colors text-left"
      >
        <div>
          <p className="text-[13px] font-medium text-[--text-primary]">{title}</p>
          <p className="text-[11px] text-[--text-muted]">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {enabled && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">Connected</span>
          )}
          <svg
            className={['w-4 h-4 text-[--text-muted] transition-transform', open ? 'rotate-180' : ''].join(' ')}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="px-4 py-4 space-y-3 border-t border-[--border] bg-[--bg-base]">
          {children}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => void onSave()}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-[--accent] text-white text-xs font-medium hover:bg-[--accent-hover] disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-[11px] text-green-400">Saved</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder = '' }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] text-[--text-muted] mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[--bg-input] border border-[--border] rounded-lg px-3 py-2 text-sm text-[--text-primary] placeholder-[--text-muted] outline-none focus:border-[--accent]"
      />
    </div>
  );
}

export default function RelayConnectorsSettings({ config, onUpdated }: Props) {
  // Slack
  const [slackEnabled, setSlackEnabled] = useState(config.integrations.slack.enabled);
  const [slackTeamId, setSlackTeamId] = useState(config.integrations.slack.teamId ?? '');
  const [slackToken, setSlackToken] = useState('');
  const [slackSaving, setSlackSaving] = useState(false);
  const [slackSaved, setSlackSaved] = useState(false);

  // Jira
  const [jiraEnabled, setJiraEnabled] = useState(config.integrations.jira.enabled);
  const [jiraSiteUrl, setJiraSiteUrl] = useState(config.integrations.jira.siteUrl);
  const [jiraEmail, setJiraEmail] = useState(config.integrations.jira.email);
  const [jiraToken, setJiraToken] = useState('');
  const [jiraSaving, setJiraSaving] = useState(false);
  const [jiraSaved, setJiraSaved] = useState(false);

  // GitHub
  const [githubEnabled, setGithubEnabled] = useState(config.integrations.github.enabled);
  const [githubPat, setGithubPat] = useState('');
  const [githubSaving, setGithubSaving] = useState(false);
  const [githubSaved, setGithubSaved] = useState(false);

  async function saveSlack() {
    setSlackSaving(true);
    setSlackSaved(false);
    try {
      await window.relay.invoke('settings:updateConnector', {
        connector: 'slack',
        enabled: slackEnabled,
        fields: { teamId: slackTeamId, botToken: slackToken },
      });
      const updated = await window.relay.invoke<HarnessConfig>('config:load');
      if (updated) onUpdated(updated);
      setSlackToken('');
      setSlackSaved(true);
    } catch (err) { console.error(err); }
    finally { setSlackSaving(false); }
  }

  async function saveJira() {
    setJiraSaving(true);
    setJiraSaved(false);
    try {
      await window.relay.invoke('settings:updateConnector', {
        connector: 'jira',
        enabled: jiraEnabled,
        fields: { siteUrl: jiraSiteUrl, email: jiraEmail, apiToken: jiraToken },
      });
      const updated = await window.relay.invoke<HarnessConfig>('config:load');
      if (updated) onUpdated(updated);
      setJiraToken('');
      setJiraSaved(true);
    } catch (err) { console.error(err); }
    finally { setJiraSaving(false); }
  }

  async function saveGithub() {
    setGithubSaving(true);
    setGithubSaved(false);
    try {
      await window.relay.invoke('settings:updateConnector', {
        connector: 'github',
        enabled: githubEnabled,
        fields: { pat: githubPat },
      });
      const updated = await window.relay.invoke<HarnessConfig>('config:load');
      if (updated) onUpdated(updated);
      setGithubPat('');
      setGithubSaved(true);
    } catch (err) { console.error(err); }
    finally { setGithubSaving(false); }
  }

  return (
    <div className="max-w-lg space-y-4">
      <p className="text-[11px] text-[--text-muted] mb-2">Configure integrations. Credentials are encrypted and stored locally.</p>

      <ConnectorCard
        title="Slack"
        description="Required for Scheduler — reads channel messages and posts results"
        enabled={slackEnabled}
        onSave={saveSlack}
        saving={slackSaving}
        saved={slackSaved}
      >
        <div className="flex items-center gap-2 mb-2">
          <input type="checkbox" id="slack-enabled" checked={slackEnabled} onChange={(e) => setSlackEnabled(e.target.checked)} className="accent-[--accent]" />
          <label htmlFor="slack-enabled" className="text-[12px] text-[--text-secondary]">Enable Slack</label>
        </div>
        <Field label="Team ID" value={slackTeamId} onChange={setSlackTeamId} placeholder="T0123ABCDEF" />
        <Field label="Bot Token" value={slackToken} onChange={setSlackToken} type="password" placeholder="xoxb-… (leave blank to keep existing)" />
      </ConnectorCard>

      <ConnectorCard
        title="Jira"
        description="Access Jira issues and projects"
        enabled={jiraEnabled}
        onSave={saveJira}
        saving={jiraSaving}
        saved={jiraSaved}
      >
        <div className="flex items-center gap-2 mb-2">
          <input type="checkbox" id="jira-enabled" checked={jiraEnabled} onChange={(e) => setJiraEnabled(e.target.checked)} className="accent-[--accent]" />
          <label htmlFor="jira-enabled" className="text-[12px] text-[--text-secondary]">Enable Jira</label>
        </div>
        <Field label="Site URL" value={jiraSiteUrl} onChange={setJiraSiteUrl} placeholder="https://yourcompany.atlassian.net" />
        <Field label="Email" value={jiraEmail} onChange={setJiraEmail} placeholder="you@company.com" />
        <Field label="API Token" value={jiraToken} onChange={setJiraToken} type="password" placeholder="leave blank to keep existing" />
      </ConnectorCard>

      <ConnectorCard
        title="GitHub"
        description="Access repositories and pull requests"
        enabled={githubEnabled}
        onSave={saveGithub}
        saving={githubSaving}
        saved={githubSaved}
      >
        <div className="flex items-center gap-2 mb-2">
          <input type="checkbox" id="github-enabled" checked={githubEnabled} onChange={(e) => setGithubEnabled(e.target.checked)} className="accent-[--accent]" />
          <label htmlFor="github-enabled" className="text-[12px] text-[--text-secondary]">Enable GitHub</label>
        </div>
        <Field label="Personal Access Token" value={githubPat} onChange={setGithubPat} type="password" placeholder="ghp_… (leave blank to keep existing)" />
      </ConnectorCard>
    </div>
  );
}
