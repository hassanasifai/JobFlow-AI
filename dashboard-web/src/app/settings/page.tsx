'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, AgentProvider } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Settings, FileText, User, Globe, Bot, AlertTriangle, Save, RefreshCcw, CheckCircle2, XCircle, DollarSign,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';

const EDITABLE = [
  { path: 'config/profile.yml', label: 'Profile', icon: User, hint: 'Your name, location, target roles, salary range.' },
  { path: 'cv.md', label: 'CV', icon: FileText, hint: 'Markdown source of your CV. Use Generate PDF after saving.' },
  { path: 'portals.yml', label: 'Portals', icon: Globe, hint: 'Source providers + tracked companies + title filters.' },
  { path: 'modes/_profile.md', label: 'Profile Mode', icon: User, hint: 'Custom archetypes, narrative, negotiation scripts.' },
  { path: 'article-digest.md', label: 'Proof Points', icon: FileText, hint: 'Detailed metrics from your articles / projects.' },
];

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        icon={Settings}
        title="Settings"
        description="Edit any JobFlow AI config file from the browser. Models tab shows AI runtime availability."
      />

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList className="flex flex-wrap">
          {EDITABLE.map((f) => (
            <TabsTrigger key={f.path} value={f.path.replace(/[\/\.]/g, '_')}>
              <f.icon className="h-3.5 w-3.5 mr-1.5" />
              {f.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="models"><Bot className="h-3.5 w-3.5 mr-1.5" /> Models</TabsTrigger>
        </TabsList>

        {EDITABLE.map((f) => (
          <TabsContent key={f.path} value={f.path.replace(/[\/\.]/g, '_')}>
            <ConfigEditor path={f.path} hint={f.hint} />
          </TabsContent>
        ))}

        <TabsContent value="models">
          <ModelsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Default = first editable tab.
EDITABLE[0] && undefined;

function ConfigEditor({ path, hint }: { path: string; hint: string }) {
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.configRead(path);
      setContent(res.content || '');
      setOriginal(res.content || '');
      setExists(res.exists);
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [path]);

  const save = async () => {
    setSaving(true);
    try {
      await api.configWrite(path, content);
      setOriginal(content);
      toast.success('Saved', { description: path });
    } catch (e) {
      toast.error('Couldn\'t save', { description: (e as Error).message });
    } finally { setSaving(false); }
  };

  const dirty = content !== original;

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base font-mono">{path}</CardTitle>
          <CardDescription className="text-xs">{hint}{!exists && ' · (will be created on save)'}</CardDescription>
        </div>
        <div className="flex items-center gap-1.5">
          <Button onClick={load} disabled={loading} size="sm" variant="ghost" className="gap-1.5">
            <RefreshCcw className="h-3.5 w-3.5" /> Reload
          </Button>
          <Button onClick={save} disabled={saving || !dirty} size="sm" className="gap-1.5">
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-3">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Couldn&apos;t load</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {loading ? (
          <Skeleton className="h-[55vh] w-full" />
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="font-mono text-xs w-full h-[55vh] resize-none rounded-md border border-input bg-transparent p-3 focus:outline-none focus:ring-2 focus:ring-ring"
            spellCheck={false}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ModelsTab() {
  const { data, isLoading } = useQuery({ queryKey: ['agents'], queryFn: api.agents });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        AI runtimes available. Set the listed env vars in <code className="text-xs px-1 rounded bg-muted">.env</code> or install the binary, then click Reload.
      </p>
      {isLoading && <Skeleton className="h-32 w-full" />}
      {!isLoading && (data || []).map((p) => <ProviderCard key={p.id} provider={p} />)}
    </div>
  );
}

function ProviderCard({ provider }: { provider: AgentProvider }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              {provider.label}
              {provider.costsMoney && <Badge variant="outline" className="text-[10px] gap-1"><DollarSign className="h-3 w-3 text-amber-500" /> Paid</Badge>}
            </CardTitle>
            <CardDescription className="text-xs"><code>{provider.id}</code> · default model: <code>{provider.defaultModel}</code></CardDescription>
          </div>
          {provider.available ? (
            <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Available</Badge>
          ) : (
            <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Unavailable</Badge>
          )}
        </div>
      </CardHeader>
      {!provider.available && (
        <CardContent>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle className="text-sm">{provider.reason}</AlertTitle>
            {provider.hint && <AlertDescription className="text-xs">{provider.hint}</AlertDescription>}
          </Alert>
        </CardContent>
      )}
    </Card>
  );
}
