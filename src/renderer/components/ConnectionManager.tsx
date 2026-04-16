import React, { useState, useEffect, useCallback } from 'react';
import {
  DEFAULT_GROUPS,
  EMPTY_FTP,
  EMPTY_S3,
  EMPTY_SFTP,
  mergeGroups,
  toSftpConnectConfig,
  toStoredProfile,
  toUIProfile,
} from '../../shared/connection-profile-ui';
import type {
  ProtocolTab,
  UIConnectionProfile as ConnectionProfile,
} from '../../shared/connection-profile-ui';
import { t } from '../lib/i18n';
import { exportToJSON, importAuto, type ImportedProfile } from '../lib/profile-io';
import { logConnection, logConnected, logError } from './LogPanel';
export type { UIConnectionProfile as ConnectionProfile } from '../../shared/connection-profile-ui';

interface ConnectionManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (profile: ConnectionProfile, connectionId: string) => void;
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.bridgefile !== 'undefined';
}

export default function ConnectionManager({
  isOpen,
  onClose,
  onConnect,
}: ConnectionManagerProps) {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProtocolTab>('SFTP');
  const [formData, setFormData] = useState<Partial<ConnectionProfile>>(EMPTY_SFTP);
  const [isEditing, setIsEditing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showProxy, setShowProxy] = useState(false);
  const [groups, setGroups] = useState<string[]>(DEFAULT_GROUPS);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [newGroupName, setNewGroupName] = useState<string | null>(null);
  const [dragProfileId, setDragProfileId] = useState<string | null>(null);

  const getEmptyForm = useCallback((tab: ProtocolTab) => {
    if (tab === 'SFTP') return { ...EMPTY_SFTP };
    if (tab === 'FTP') return { ...EMPTY_FTP };
    return { ...EMPTY_S3 };
  }, []);

  const loadProfiles = useCallback(async () => {
    if (!isElectron()) {
      setProfiles([]);
      setGroups(DEFAULT_GROUPS);
      return;
    }

    try {
      const saved = await window.bridgefile.connections.getAll();
      const uiProfiles = saved.map(toUIProfile);
      setProfiles(uiProfiles);
      setGroups(mergeGroups(uiProfiles));
    } catch {
      setProfiles([]);
      setGroups(DEFAULT_GROUPS);
    }
  }, []);

  const persistProfile = useCallback(
    async (profile: ConnectionProfile): Promise<ConnectionProfile> => {
      if (!isElectron()) return profile;
      const saved = await window.bridgefile.connections.save(toStoredProfile(profile));
      return toUIProfile(saved);
    },
    [],
  );

  const applyProfileLocally = useCallback((profile: ConnectionProfile) => {
    setProfiles((prev) => {
      const exists = prev.some((entry) => entry.id === profile.id);
      const next = exists
        ? prev.map((entry) => (entry.id === profile.id ? profile : entry))
        : [...prev, profile];
      setGroups(mergeGroups(next));
      return next;
    });
    if (selectedId === profile.id) {
      setFormData(profile);
    }
  }, [selectedId]);

  useEffect(() => {
    if (isOpen) {
      void loadProfiles();
    }
  }, [isOpen, loadProfiles]);

  if (!isOpen) return null;

  const selectedProfile = profiles.find(p => p.id === selectedId);

  const handleSelectProfile = (profile: ConnectionProfile) => {
    setSelectedId(profile.id);
    setFormData({ ...profile });
    setActiveTab(profile.type);
    setIsEditing(false);
    setConnectError(null);
    setShowProxy(Boolean(profile.proxyHost || profile.proxyUsername || profile.proxyPassword));
  };

  const handleNewConnection = () => {
    setSelectedId(null);
    setIsEditing(true);
    setFormData(getEmptyForm(activeTab));
    setConnectError(null);
    setShowProxy(false);
  };

  const handleTabSwitch = (tab: ProtocolTab) => {
    setActiveTab(tab);
    if (isEditing && !selectedId) {
      setFormData(getEmptyForm(tab));
    }
    setConnectError(null);
    if (tab !== 'SFTP') {
      setShowProxy(false);
    }
  };

  const handleSave = async () => {
    const newProfile: ConnectionProfile = {
      ...formData,
      id: selectedId || Date.now().toString(),
      name: formData.name?.trim() || 'Untitled',
      type: activeTab,
      favorite: Boolean(formData.favorite),
      lastUsed: selectedProfile?.lastUsed ?? formData.lastUsed,
    } as ConnectionProfile;

    if (isElectron()) {
      try {
        const saved = await persistProfile(newProfile);
        applyProfileLocally(saved);
        setFormData(saved);
      } catch {
        // Fallback to local state
        applyProfileLocally(newProfile);
      }
    } else {
      applyProfileLocally(newProfile);
    }
    setSelectedId(newProfile.id);
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (!selectedId) return;

    const removeProfileLocally = () => {
      setProfiles((prev) => {
        const next = prev.filter((profile) => profile.id !== selectedId);
        setGroups(mergeGroups(next));
        return next;
      });
    };

    if (isElectron()) {
      try {
        await window.bridgefile.connections.delete(selectedId);
        removeProfileLocally();
      } catch {
        removeProfileLocally();
      }
    } else {
      removeProfileLocally();
    }
    setSelectedId(null);
    setFormData(getEmptyForm(activeTab));
    setIsEditing(false);
  };

  const handleConnect = async () => {
    const profile = selectedProfile || ({
      ...formData,
      id: Date.now().toString(),
      type: activeTab,
      favorite: false,
    } as ConnectionProfile);

    setConnectError(null);

    if (!isElectron()) {
      setConnectError('Desktop app required for connections');
      return;
    }

    setConnecting(true);
    logConnection(profile.type, profile.host || profile.bucket || 'server', profile.username);

    try {
      let connId: string;

      if (profile.type === 'SFTP') {
        connId = await window.bridgefile.sftp.connect(toSftpConnectConfig(profile));
      } else if (profile.type === 'FTP') {
        connId = await window.bridgefile.ftp.connect({
          host: profile.host || '',
          port: profile.port || 21,
          username: profile.username || '',
          password: profile.password || '',
          secure: profile.secure || false,
          timeout: profile.timeout ?? 30,
        });
      } else {
        // S3
        connId = await window.bridgefile.s3.connect({
          accessKeyId: profile.accessKey || '',
          secretAccessKey: profile.secretKey || '',
          region: profile.region || 'us-east-1',
          bucket: profile.bucket || '',
          prefix: profile.prefix,
          endpoint: profile.endpoint,
          timeout: profile.timeout ?? 30,
        });
      }

      const connectedProfile = {
        ...profile,
        lastUsed: Date.now(),
      };
      if (selectedProfile) {
        applyProfileLocally(connectedProfile);
        void persistProfile(connectedProfile)
          .then((saved) => applyProfileLocally(saved))
          .catch(() => undefined);
      }

      logConnected(profile.type, profile.host || profile.bucket || 'server', profile.username);
      onConnect(connectedProfile, connId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`Connection failed: ${msg}`);
      setConnectError(msg);
    } finally {
      setConnecting(false);
    }
  };

  // Test connection without saving/persisting
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    if (!isElectron()) {
      setTestResult({ ok: false, message: 'Desktop app required' });
      return;
    }
    const profile = selectedProfile || ({
      ...formData,
      id: 'test-' + Date.now().toString(),
      type: activeTab,
      favorite: false,
    } as ConnectionProfile);

    setTesting(true);
    setTestResult(null);
    let connId: string | null = null;
    try {
      if (profile.type === 'SFTP') {
        connId = await window.bridgefile.sftp.connect(toSftpConnectConfig(profile));
        await window.bridgefile.sftp.list(connId, '/');
      } else if (profile.type === 'FTP') {
        connId = await window.bridgefile.ftp.connect({
          host: profile.host || '',
          port: profile.port || 21,
          username: profile.username || '',
          password: profile.password || '',
          secure: profile.secure || false,
          timeout: profile.timeout ?? 30,
        });
        await window.bridgefile.ftp.list(connId, '/');
      } else {
        connId = await window.bridgefile.s3.connect({
          accessKeyId: profile.accessKey || '',
          secretAccessKey: profile.secretKey || '',
          region: profile.region || 'us-east-1',
          bucket: profile.bucket || '',
          prefix: profile.prefix,
          endpoint: profile.endpoint,
          timeout: profile.timeout ?? 30,
        });
        await window.bridgefile.s3.list(connId, '/');
      }
      setTestResult({ ok: true, message: 'Connection successful' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ ok: false, message: msg });
    } finally {
      // Clean up test connection
      if (connId) {
        const proto = profile.type.toLowerCase() as 'sftp' | 'ftp' | 's3';
        window.bridgefile[proto].disconnect(connId).catch(() => {});
      }
      setTesting(false);
    }
  };

  const toggleFavorite = (id: string) => {
    const profile = profiles.find((entry) => entry.id === id);
    if (!profile) return;

    const updated = { ...profile, favorite: !profile.favorite };
    applyProfileLocally(updated);
    void persistProfile(updated)
      .then((saved) => applyProfileLocally(saved))
      .catch(() => undefined);
  };

  const updateField = (key: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setConnectError(null);
  };

  const favorites = profiles.filter(p => p.favorite);
  const recent = [...profiles]
    .filter((profile) => typeof profile.lastUsed === 'number')
    .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
    .slice(0, 5);

  // Group profiles by their group field
  const groupedProfiles = new Map<string, ConnectionProfile[]>();
  const ungrouped: ConnectionProfile[] = [];
  for (const p of profiles) {
    if (p.group) {
      if (!groupedProfiles.has(p.group)) groupedProfiles.set(p.group, []);
      groupedProfiles.get(p.group)!.push(p);
    } else {
      ungrouped.push(p);
    }
  }
  // Ensure all known groups appear even if empty
  for (const g of groups) {
    if (!groupedProfiles.has(g)) groupedProfiles.set(g, []);
  }

  const toggleGroupCollapsed = (group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const handleDragStart = (profileId: string) => {
    setDragProfileId(profileId);
  };

  const handleDropOnGroup = (group: string) => {
    if (!dragProfileId) return;
    const profile = profiles.find((entry) => entry.id === dragProfileId);
    if (!profile) return;

    const updated = { ...profile, group };
    applyProfileLocally(updated);
    void persistProfile(updated)
      .then((saved) => applyProfileLocally(saved))
      .catch(() => undefined);
    setDragProfileId(null);
  };

  const handleCreateGroup = () => {
    if (newGroupName && newGroupName.trim() && !groups.includes(newGroupName.trim())) {
      setGroups(prev => [...prev, newGroupName.trim()]);
    }
    setNewGroupName(null);
  };

  // ── SSH key generation ────────────────────────────────────

  const handleGenerateKey = async () => {
    if (!isElectron()) return;
    const passphrase = window.prompt(
      'Enter a passphrase for the new SSH key (leave blank for no passphrase).\n\nA new ed25519 key pair will be created in ~/.ssh/',
      '',
    );
    if (passphrase === null) return; // user cancelled
    try {
      const result = await window.bridgefile.app.generateSSHKey({
        type: 'ed25519',
        passphrase: passphrase || undefined,
      });
      updateField('privateKeyPath', result.privateKeyPath);
      if (passphrase) updateField('passphrase', passphrase);
      window.prompt(
        `Key pair created!\n\nPrivate key: ${result.privateKeyPath}\nPublic key:  ${result.publicKeyPath}\n\nCopy the public key below and add it to the server's ~/.ssh/authorized_keys:`,
        result.publicKeyOpenSSH,
      );
    } catch (err) {
      alert(`Key generation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // ── Import / Export ───────────────────────────────────────

  const handleExport = () => {
    const toExport: ImportedProfile[] = profiles.map((p) => ({
      name: p.name,
      type: p.type,
      host: p.host,
      port: p.port,
      username: p.username,
      accessKeyId: p.accessKey,
      // Intentionally DO NOT export secrets (password/secretKey/privateKey) —
      // exports are meant to be shareable / version-controlled.
      region: p.region,
      bucket: p.bucket,
      prefix: p.prefix,
      endpoint: p.endpoint,
      secure: p.secure,
      proxyHost: p.proxyHost,
      proxyPort: p.proxyPort,
      proxyUsername: p.proxyUsername,
      timeout: p.timeout,
      group: p.group,
      favorite: p.favorite,
    }));
    const json = exportToJSON(toExport);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bridgefile-profiles-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.xml,.ini';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = importAuto(text, file.name);
        let added = 0;
        for (const p of imported) {
          const profile: ConnectionProfile = {
            id: crypto.randomUUID(),
            name: p.name,
            type: p.type,
            favorite: p.favorite ?? false,
            group: p.group,
            host: p.host,
            port: p.port,
            username: p.username,
            accessKey: p.accessKeyId,
            region: p.region,
            bucket: p.bucket,
            prefix: p.prefix,
            endpoint: p.endpoint,
            secure: p.secure,
            proxyHost: p.proxyHost,
            proxyPort: p.proxyPort,
            proxyUsername: p.proxyUsername,
            timeout: p.timeout,
          };
          try {
            const saved = await persistProfile(profile);
            applyProfileLocally(saved);
            added++;
          } catch {
            // skip failed ones
          }
        }
        alert(`Imported ${added} of ${imported.length} profiles.\n\nNote: passwords/keys must be re-entered for security.`);
      } catch (err) {
        alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    input.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[720px] max-h-[600px] bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-2xl flex overflow-hidden">
        {/* Left: Profile list */}
        <div className="w-56 border-r border-[#1e1e2e] flex flex-col">
          <div className="p-3 border-b border-[#1e1e2e]">
            <h2 className="text-sm font-semibold text-[#e4e4e7] mb-2">{t('connections')}</h2>
            <div className="flex gap-1">
              <button
                onClick={handleNewConnection}
                className="flex-1 px-2.5 py-1.5 text-xs rounded bg-[#3b82f6] text-white hover:bg-[#2563eb] transition-colors"
              >
                {t('new_connection')}
              </button>
              <button
                onClick={() => setNewGroupName('')}
                className="px-2 py-1.5 text-xs rounded text-[#a1a1aa] hover:bg-[#1a1a26] border border-[#1e1e2e] transition-colors"
                title={t('new_folder')}
                aria-label="New group"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
            </div>
            {/* Import / Export row */}
            <div className="flex gap-1 mt-2">
              <button
                onClick={handleImport}
                className="flex-1 px-2 py-1 text-[10px] rounded text-[#a1a1aa] hover:bg-[#1a1a26] border border-[#1e1e2e] transition-colors"
                title="Import profiles from JSON, FileZilla XML, or WinSCP INI"
              >
                Import
              </button>
              <button
                onClick={handleExport}
                disabled={profiles.length === 0}
                className="flex-1 px-2 py-1 text-[10px] rounded text-[#a1a1aa] hover:bg-[#1a1a26] border border-[#1e1e2e] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Export all profiles to JSON (secrets excluded)"
              >
                Export
              </button>
            </div>
            {newGroupName !== null && (
              <div className="mt-2 flex gap-1">
                <input
                  type="text"
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateGroup(); if (e.key === 'Escape') setNewGroupName(null); }}
                  placeholder="Group name"
                  className="flex-1 px-2 py-1 text-xs bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={handleCreateGroup}
                  className="px-2 py-1 text-xs rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors"
                >
                  Add
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Favorites */}
            {favorites.length > 0 && (
              <div className="px-3 pt-3">
                <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1.5 font-medium">
                  {t('favorites')}
                </div>
                {favorites.map(p => (
                  <ProfileItem
                    key={p.id}
                    profile={p}
                    selected={p.id === selectedId}
                    onSelect={() => handleSelectProfile(p)}
                    onToggleFavorite={() => toggleFavorite(p.id)}
                    onDragStart={() => handleDragStart(p.id)}
                  />
                ))}
              </div>
            )}

            {/* Recent */}
            {recent.length > 0 && (
              <div className="px-3 pt-3">
                <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1.5 font-medium">
                  {t('recent')}
                </div>
                {recent.map(p => (
                  <ProfileItem
                    key={`recent-${p.id}`}
                    profile={p}
                    selected={p.id === selectedId}
                    onSelect={() => handleSelectProfile(p)}
                    onToggleFavorite={() => toggleFavorite(p.id)}
                    onDragStart={() => handleDragStart(p.id)}
                  />
                ))}
              </div>
            )}

            {/* Groups */}
            {[...groupedProfiles.entries()].map(([groupName, groupProfiles]) => (
              <div
                key={groupName}
                className="px-3 pt-3"
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={e => { e.preventDefault(); handleDropOnGroup(groupName); }}
              >
                <button
                  onClick={() => toggleGroupCollapsed(groupName)}
                  className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#71717a] mb-1.5 font-medium w-full text-left hover:text-[#a1a1aa] transition-colors"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    className={`transition-transform ${collapsedGroups.has(groupName) ? '' : 'rotate-90'}`}
                  >
                    <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="text-[#71717a]">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                  {groupName}
                  <span className="text-[9px] text-[#4a4a5a] ml-auto">{groupProfiles.length}</span>
                </button>
                {!collapsedGroups.has(groupName) &&
                  groupProfiles.map(p => (
                    <ProfileItem
                      key={p.id}
                      profile={p}
                      selected={p.id === selectedId}
                      onSelect={() => handleSelectProfile(p)}
                      onToggleFavorite={() => toggleFavorite(p.id)}
                      onDragStart={() => handleDragStart(p.id)}
                    />
                  ))}
              </div>
            ))}

            {/* Ungrouped */}
            {ungrouped.length > 0 && (
              <div className="px-3 pt-3 pb-3">
                <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1.5 font-medium">
                  {t('ungrouped')}
                </div>
                {ungrouped.map(p => (
                  <ProfileItem
                    key={p.id}
                    profile={p}
                    selected={p.id === selectedId}
                    onSelect={() => handleSelectProfile(p)}
                    onToggleFavorite={() => toggleFavorite(p.id)}
                    onDragStart={() => handleDragStart(p.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Form */}
        <div className="flex-1 flex flex-col">
          {/* Header + close */}
          <div className="flex items-center justify-between p-3 border-b border-[#1e1e2e]">
            <div className="flex items-center gap-2">
              {/* Tabs */}
              <button
                onClick={() => handleTabSwitch('SFTP')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  activeTab === 'SFTP'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'text-[#71717a] hover:text-[#a1a1aa]'
                }`}
              >
                SFTP
              </button>
              <button
                onClick={() => handleTabSwitch('FTP')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  activeTab === 'FTP'
                    ? 'bg-blue-500/15 text-blue-400'
                    : 'text-[#71717a] hover:text-[#a1a1aa]'
                }`}
              >
                FTP
              </button>
              <button
                onClick={() => handleTabSwitch('S3')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  activeTab === 'S3'
                    ? 'bg-orange-500/15 text-orange-400'
                    : 'text-[#71717a] hover:text-[#a1a1aa]'
                }`}
              >
                S3
              </button>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded text-[#71717a] hover:text-[#e4e4e7] hover:bg-[#1a1a26] transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Form body */}
          <div className="flex-1 overflow-y-auto p-4">
            {/* Connection name */}
            <div className="mb-3">
              <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                {t('connection_name')}
              </label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={e => updateField('name', e.target.value)}
                placeholder="My Server"
                className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
              />
            </div>

            {/* Group selector */}
            <div className="mb-3">
              <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                Group
              </label>
              <select
                value={formData.group || ''}
                onChange={e => updateField('group', e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] focus:border-[#3b82f6] focus:outline-none transition-colors"
              >
                <option value="">No group</option>
                {groups.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            {activeTab === 'SFTP' ? (
              <>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="col-span-2">
                    <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                      Host
                    </label>
                    <input
                      type="text"
                      value={formData.host || ''}
                      onChange={e => updateField('host', e.target.value)}
                      placeholder="example.com"
                      className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                      Port
                    </label>
                    <input
                      type="number"
                      value={formData.port || 22}
                      onChange={e => updateField('port', parseInt(e.target.value) || 22)}
                      className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] focus:border-[#3b82f6] focus:outline-none transition-colors"
                    />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                    Username
                  </label>
                  <input
                    type="text"
                    value={formData.username || ''}
                    onChange={e => updateField('username', e.target.value)}
                    placeholder="root"
                    className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                    Password
                  </label>
                  <input
                    type="password"
                    value={formData.password || ''}
                    onChange={e => updateField('password', e.target.value)}
                    placeholder="Leave blank if using key"
                    className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
                  />
                </div>
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] text-[#71717a] uppercase tracking-wide">
                      Private Key Path
                    </label>
                    <button
                      type="button"
                      onClick={handleGenerateKey}
                      className="text-[10px] text-[#3b82f6] hover:text-[#60a5fa] hover:underline"
                      title="Generate a new ed25519 SSH key pair"
                    >
                      Generate new key
                    </button>
                  </div>
                  <input
                    type="text"
                    value={formData.privateKeyPath || ''}
                    onChange={e => updateField('privateKeyPath', e.target.value)}
                    placeholder="~/.ssh/id_rsa"
                    className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors font-mono text-xs"
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                    Key Passphrase
                  </label>
                  <input
                    type="password"
                    value={formData.passphrase || ''}
                    onChange={e => updateField('passphrase', e.target.value)}
                    placeholder="Leave blank for unencrypted keys"
                    className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
                  />
                </div>

                {/* Jump Host / Proxy section */}
                <div className="mb-3">
                  <button
                    onClick={() => setShowProxy(!showProxy)}
                    className="flex items-center gap-1.5 text-[11px] text-[#71717a] hover:text-[#a1a1aa] uppercase tracking-wide transition-colors"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      className={`transition-transform ${showProxy ? 'rotate-90' : ''}`}
                    >
                      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Jump Host / Proxy
                  </button>
                  {showProxy && (
                    <div className="mt-2 pl-3 border-l-2 border-[#1e1e2e]">
                      <div className="grid grid-cols-3 gap-3 mb-2">
                        <div className="col-span-2">
                          <label className="block text-[10px] text-[#71717a] mb-1 uppercase tracking-wide">
                            Proxy Host
                          </label>
                          <input
                            type="text"
                            value={formData.proxyHost || ''}
                            onChange={e => updateField('proxyHost', e.target.value)}
                            placeholder="jump.example.com"
                            className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-[#71717a] mb-1 uppercase tracking-wide">
                            Port
                          </label>
                          <input
                            type="number"
                            value={formData.proxyPort || 22}
                            onChange={e => updateField('proxyPort', parseInt(e.target.value) || 22)}
                            className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] focus:border-[#3b82f6] focus:outline-none transition-colors"
                          />
                        </div>
                      </div>
                      <div className="mb-2">
                        <label className="block text-[10px] text-[#71717a] mb-1 uppercase tracking-wide">
                          Proxy Username
                        </label>
                        <input
                          type="text"
                          value={formData.proxyUsername || ''}
                          onChange={e => updateField('proxyUsername', e.target.value)}
                          placeholder="Same as above if blank"
                          className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
                        />
                      </div>
                      <div className="mb-2">
                        <label className="block text-[10px] text-[#71717a] mb-1 uppercase tracking-wide">
                          Proxy Password
                        </label>
                        <input
                          type="password"
                          value={formData.proxyPassword || ''}
                          onChange={e => updateField('proxyPassword', e.target.value)}
                          placeholder="Proxy password"
                          className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Timeout */}
                <div className="mb-3">
                  <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                    Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    value={formData.timeout ?? 30}
                    onChange={e => updateField('timeout', parseInt(e.target.value) || 30)}
                    min={1}
                    max={300}
                    className="w-24 px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] focus:border-[#3b82f6] focus:outline-none transition-colors"
                  />
                </div>
              </>
            ) : activeTab === 'FTP' ? (
              <>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="col-span-2">
                    <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                      Host
                    </label>
                    <input
                      type="text"
                      value={formData.host || ''}
                      onChange={e => updateField('host', e.target.value)}
                      placeholder="ftp.example.com"
                      className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                      Port
                    </label>
                    <input
                      type="number"
                      value={formData.port || 21}
                      onChange={e => updateField('port', parseInt(e.target.value) || 21)}
                      className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] focus:border-[#3b82f6] focus:outline-none transition-colors"
                    />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                    Username
                  </label>
                  <input
                    type="text"
                    value={formData.username || ''}
                    onChange={e => updateField('username', e.target.value)}
                    placeholder="ftpuser"
                    className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                    Password
                  </label>
                  <input
                    type="password"
                    value={formData.password || ''}
                    onChange={e => updateField('password', e.target.value)}
                    placeholder="Password"
                    className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
                  />
                </div>
                <div className="mb-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div
                      onClick={() => updateField('secure', !formData.secure)}
                      className={`relative w-8 h-[18px] rounded-full transition-colors ${
                        formData.secure ? 'bg-[#3b82f6]' : 'bg-[#1e1e2e]'
                      }`}
                    >
                      <div
                        className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                          formData.secure ? 'translate-x-[16px]' : 'translate-x-[2px]'
                        }`}
                      />
                    </div>
                    <span className="text-[11px] text-[#a1a1aa] uppercase tracking-wide">
                      Use FTPS (TLS)
                    </span>
                  </label>
                  {formData.secure && (
                    <p className="mt-1.5 text-[10px] text-[#71717a] leading-relaxed">
                      Implicit TLS on port 990 or Explicit TLS on port 21
                    </p>
                  )}
                </div>

                {/* Timeout */}
                <div className="mb-3">
                  <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                    Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    value={formData.timeout ?? 30}
                    onChange={e => updateField('timeout', parseInt(e.target.value) || 30)}
                    min={1}
                    max={300}
                    className="w-24 px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] focus:border-[#3b82f6] focus:outline-none transition-colors"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                      Access Key
                    </label>
                    <input
                      type="text"
                      value={formData.accessKey || ''}
                      onChange={e => updateField('accessKey', e.target.value)}
                      placeholder="AKIA..."
                      className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                      Secret Key
                    </label>
                    <input
                      type="password"
                      value={formData.secretKey || ''}
                      onChange={e => updateField('secretKey', e.target.value)}
                      placeholder="Secret access key"
                      className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                      Region
                    </label>
                    <input
                      type="text"
                      value={formData.region || ''}
                      onChange={e => updateField('region', e.target.value)}
                      placeholder="us-east-1"
                      className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                      Bucket <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.bucket || ''}
                      onChange={e => updateField('bucket', e.target.value)}
                      placeholder="my-bucket"
                      className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
                    />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                    Prefix <span className="text-[#71717a] normal-case">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.prefix || ''}
                    onChange={e => updateField('prefix', e.target.value)}
                    placeholder="path/to/files/"
                    className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                    Custom Endpoint{' '}
                    <span className="text-[#71717a] normal-case">(S3-compatible)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.endpoint || ''}
                    onChange={e => updateField('endpoint', e.target.value)}
                    placeholder="https://minio.example.com:9000"
                    className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors font-mono text-xs"
                  />
                </div>

                {/* Timeout */}
                <div className="mb-3">
                  <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                    Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    value={formData.timeout ?? 30}
                    onChange={e => updateField('timeout', parseInt(e.target.value) || 30)}
                    min={1}
                    max={300}
                    className="w-24 px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] focus:border-[#3b82f6] focus:outline-none transition-colors"
                  />
                </div>
              </>
            )}

            {/* Connection error display */}
            {connectError && (
              <div className="mt-2 px-3 py-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded">
                {connectError}
              </div>
            )}
          </div>

          {/* Bottom actions */}
          <div className="flex items-center justify-between p-3 border-t border-[#1e1e2e]">
            <div>
              {selectedId && (
                <button
                  onClick={handleDelete}
                  className="px-3 py-1.5 text-xs rounded text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors"
                >
                  {t('delete')}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {testResult && (
                <span
                  className={`text-[11px] font-medium mr-1 ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}
                  role="status"
                >
                  {testResult.ok ? '✓' : '✗'} {testResult.message.slice(0, 60)}
                </span>
              )}
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs rounded text-[#a1a1aa] hover:bg-[#1a1a26] border border-[#1e1e2e] transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleTest}
                disabled={testing}
                className={`px-3 py-1.5 text-xs rounded text-[#a1a1aa] hover:bg-[#1a1a26] border border-[#1e1e2e] transition-colors ${
                  testing ? 'cursor-wait opacity-60' : ''
                }`}
                title="Test connection without saving"
              >
                {testing ? 'Testing…' : 'Test'}
              </button>
              <button
                onClick={handleSave}
                className="px-3 py-1.5 text-xs rounded text-[#e4e4e7] hover:bg-[#1a1a26] border border-[#1e1e2e] transition-colors"
              >
                {t('save')}
              </button>
              <button
                onClick={handleConnect}
                disabled={connecting}
                className={`px-4 py-1.5 text-xs rounded transition-colors ${
                  connecting
                    ? 'bg-[#3b82f6]/50 text-white/50 cursor-wait'
                    : 'bg-[#3b82f6] text-white hover:bg-[#2563eb]'
                }`}
              >
                {connecting ? t('connecting') : t('connect')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileItem({
  profile,
  selected,
  onSelect,
  onToggleFavorite,
  onDragStart,
}: {
  profile: ConnectionProfile;
  selected: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onDragStart?: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      draggable
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', profile.id);
        onDragStart?.();
      }}
      className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer group transition-colors mb-0.5 ${
        selected
          ? 'bg-[#3b82f6]/10 text-[#e4e4e7]'
          : 'text-[#a1a1aa] hover:bg-[#1a1a26]'
      }`}
    >
      {/* Protocol icon */}
      <span
        className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold shrink-0 ${
          profile.type === 'SFTP'
            ? 'bg-emerald-500/15 text-emerald-400'
            : profile.type === 'FTP'
            ? 'bg-blue-500/15 text-blue-400'
            : 'bg-orange-500/15 text-orange-400'
        }`}
      >
        {profile.type === 'SFTP' ? 'SF' : profile.type === 'FTP' ? 'FT' : 'S3'}
      </span>

      {/* Name */}
      <span className="flex-1 truncate">{profile.name}</span>

      {/* Favorite star */}
      <button
        onClick={e => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className={`shrink-0 transition-opacity ${
          profile.favorite
            ? 'text-amber-400 opacity-100'
            : 'text-[#71717a] opacity-0 group-hover:opacity-100'
        }`}
      >
        {profile.favorite ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        )}
      </button>
    </div>
  );
}
