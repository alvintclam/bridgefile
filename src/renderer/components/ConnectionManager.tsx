import React, { useState } from 'react';

export interface ConnectionProfile {
  id: string;
  name: string;
  type: 'SFTP' | 'S3' | 'FTP';
  favorite: boolean;
  lastUsed?: Date;
  /** Group/folder for organizing connections */
  group?: string;
  // SFTP
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  // SFTP proxy / jump host
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
  // FTP / FTPS
  secure?: boolean;
  // S3
  accessKey?: string;
  secretKey?: string;
  region?: string;
  bucket?: string;
  prefix?: string;
  endpoint?: string;
}

interface ConnectionManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (profile: ConnectionProfile, connectionId: string) => void;
}

const DEFAULT_GROUPS = ['Production', 'Staging', 'Personal'];

const MOCK_PROFILES: ConnectionProfile[] = [
  {
    id: '1',
    name: 'Production Server',
    type: 'SFTP',
    favorite: true,
    lastUsed: new Date('2026-04-08'),
    host: '192.168.1.100',
    port: 22,
    username: 'deploy',
    group: 'Production',
  },
  {
    id: '2',
    name: 'Staging Server',
    type: 'SFTP',
    favorite: false,
    lastUsed: new Date('2026-04-05'),
    host: 'staging.example.com',
    port: 22,
    username: 'ubuntu',
    group: 'Staging',
  },
  {
    id: '3',
    name: 'Assets Bucket',
    type: 'S3',
    favorite: true,
    lastUsed: new Date('2026-04-07'),
    bucket: 'company-assets',
    region: 'us-east-1',
    group: 'Production',
  },
  {
    id: '4',
    name: 'Backups (MinIO)',
    type: 'S3',
    favorite: false,
    lastUsed: new Date('2026-03-20'),
    bucket: 'backups',
    region: 'us-east-1',
    endpoint: 'https://minio.internal:9000',
    group: 'Personal',
  },
];

const EMPTY_SFTP: Partial<ConnectionProfile> = {
  name: '',
  type: 'SFTP',
  host: '',
  port: 22,
  username: '',
  password: '',
  privateKeyPath: '',
  proxyHost: '',
  proxyPort: 22,
  proxyUsername: '',
  proxyPassword: '',
  favorite: false,
  group: '',
};

const EMPTY_FTP: Partial<ConnectionProfile> = {
  name: '',
  type: 'FTP',
  host: '',
  port: 21,
  username: '',
  password: '',
  secure: false,
  favorite: false,
  group: '',
};

const EMPTY_S3: Partial<ConnectionProfile> = {
  name: '',
  type: 'S3',
  accessKey: '',
  secretKey: '',
  region: 'us-east-1',
  bucket: '',
  prefix: '',
  endpoint: '',
  favorite: false,
  group: '',
};

function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.bridgefile !== 'undefined';
}

export default function ConnectionManager({
  isOpen,
  onClose,
  onConnect,
}: ConnectionManagerProps) {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>(MOCK_PROFILES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'SFTP' | 'FTP' | 'S3'>('SFTP');
  const [formData, setFormData] = useState<Partial<ConnectionProfile>>(EMPTY_SFTP);
  const [isEditing, setIsEditing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showProxy, setShowProxy] = useState(false);
  const [groups, setGroups] = useState<string[]>(DEFAULT_GROUPS);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [newGroupName, setNewGroupName] = useState<string | null>(null);
  const [dragProfileId, setDragProfileId] = useState<string | null>(null);

  if (!isOpen) return null;

  const selectedProfile = profiles.find(p => p.id === selectedId);

  const handleSelectProfile = (profile: ConnectionProfile) => {
    setSelectedId(profile.id);
    setFormData({ ...profile });
    setActiveTab(profile.type);
    setIsEditing(false);
    setConnectError(null);
  };

  const getEmptyForm = (tab: 'SFTP' | 'FTP' | 'S3') => {
    if (tab === 'SFTP') return { ...EMPTY_SFTP };
    if (tab === 'FTP') return { ...EMPTY_FTP };
    return { ...EMPTY_S3 };
  };

  const handleNewConnection = () => {
    setSelectedId(null);
    setIsEditing(true);
    setFormData(getEmptyForm(activeTab));
    setConnectError(null);
  };

  const handleTabSwitch = (tab: 'SFTP' | 'FTP' | 'S3') => {
    setActiveTab(tab);
    if (isEditing && !selectedId) {
      setFormData(getEmptyForm(tab));
    }
    setConnectError(null);
  };

  const handleSave = () => {
    const newProfile: ConnectionProfile = {
      ...formData,
      id: selectedId || Date.now().toString(),
      name: formData.name || 'Untitled',
      type: activeTab,
      favorite: formData.favorite || false,
    } as ConnectionProfile;

    if (selectedId) {
      setProfiles(prev => prev.map(p => (p.id === selectedId ? newProfile : p)));
    } else {
      setProfiles(prev => [...prev, newProfile]);
    }
    setSelectedId(newProfile.id);
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (!selectedId) return;
    setProfiles(prev => prev.filter(p => p.id !== selectedId));
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
      // Not in Electron -- use a mock connectionId
      onConnect(profile, 'mock-' + Date.now());
      return;
    }

    setConnecting(true);

    try {
      let connId: string;

      if (profile.type === 'SFTP') {
        const sftpConfig: Record<string, unknown> = {
          host: profile.host || '',
          port: profile.port || 22,
          username: profile.username || '',
          password: profile.password,
          privateKey: profile.privateKeyPath,
        };
        if (profile.proxyHost) {
          sftpConfig.proxyHost = profile.proxyHost;
          sftpConfig.proxyPort = profile.proxyPort || 22;
          sftpConfig.proxyUsername = profile.proxyUsername;
          sftpConfig.proxyPassword = profile.proxyPassword;
        }
        connId = await window.bridgefile.sftp.connect(sftpConfig as any);
      } else if (profile.type === 'FTP') {
        connId = await window.bridgefile.ftp.connect({
          host: profile.host || '',
          port: profile.port || 21,
          username: profile.username || '',
          password: profile.password || '',
          secure: profile.secure || false,
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
        });
      }

      onConnect(profile, connId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setConnectError(msg);
    } finally {
      setConnecting(false);
    }
  };

  const toggleFavorite = (id: string) => {
    setProfiles(prev =>
      prev.map(p => (p.id === id ? { ...p, favorite: !p.favorite } : p))
    );
  };

  const updateField = (key: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setConnectError(null);
  };

  const favorites = profiles.filter(p => p.favorite);
  const recent = [...profiles]
    .filter(p => p.lastUsed)
    .sort((a, b) => (b.lastUsed?.getTime() || 0) - (a.lastUsed?.getTime() || 0))
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
    setProfiles(prev =>
      prev.map(p => (p.id === dragProfileId ? { ...p, group } : p)),
    );
    // Also update form data if the dragged profile is selected
    if (dragProfileId === selectedId) {
      setFormData(prev => ({ ...prev, group }));
    }
    setDragProfileId(null);
  };

  const handleCreateGroup = () => {
    if (newGroupName && newGroupName.trim() && !groups.includes(newGroupName.trim())) {
      setGroups(prev => [...prev, newGroupName.trim()]);
    }
    setNewGroupName(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[720px] max-h-[600px] bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-2xl flex overflow-hidden">
        {/* Left: Profile list */}
        <div className="w-56 border-r border-[#1e1e2e] flex flex-col">
          <div className="p-3 border-b border-[#1e1e2e]">
            <h2 className="text-sm font-semibold text-[#e4e4e7] mb-2">Connections</h2>
            <div className="flex gap-1">
              <button
                onClick={handleNewConnection}
                className="flex-1 px-2.5 py-1.5 text-xs rounded bg-[#3b82f6] text-white hover:bg-[#2563eb] transition-colors"
              >
                + New
              </button>
              <button
                onClick={() => setNewGroupName('')}
                className="px-2 py-1.5 text-xs rounded text-[#a1a1aa] hover:bg-[#1a1a26] border border-[#1e1e2e] transition-colors"
                title="New Group"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" />
                </svg>
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
                  Favorites
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
                  Ungrouped
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
                Connection Name
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
                  <label className="block text-[11px] text-[#71717a] mb-1 uppercase tracking-wide">
                    Private Key Path
                  </label>
                  <input
                    type="text"
                    value={formData.privateKeyPath || ''}
                    onChange={e => updateField('privateKeyPath', e.target.value)}
                    placeholder="~/.ssh/id_rsa"
                    className="w-full px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors font-mono text-xs"
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
                  Delete
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs rounded text-[#a1a1aa] hover:bg-[#1a1a26] border border-[#1e1e2e] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-3 py-1.5 text-xs rounded text-[#e4e4e7] hover:bg-[#1a1a26] border border-[#1e1e2e] transition-colors"
              >
                Save
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
                {connecting ? 'Connecting...' : 'Connect'}
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
