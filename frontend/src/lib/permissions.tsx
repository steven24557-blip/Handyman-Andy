import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { AudioModule } from 'expo-audio';
import { useCameraPermissions } from 'expo-camera';
import NoticeAtCollection, { PermissionKind } from '@/src/components/NoticeAtCollection';

type Result = { granted: boolean; canAskAgain?: boolean };

type Ctx = {
  /** Show CPRA Notice at Collection, then trigger the OS permission prompt. */
  requestWithNotice: (kind: PermissionKind, opts?: { requester?: () => Promise<Result> }) => Promise<Result>;
};

const PermissionsContext = createContext<Ctx | null>(null);

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const [kind, setKind] = useState<PermissionKind | null>(null);
  const resolverRef = useRef<((r: Result) => void) | null>(null);
  const requesterRef = useRef<(() => Promise<Result>) | null>(null);

  const requestWithNotice = useCallback((k: PermissionKind, opts?: { requester?: () => Promise<Result> }) => {
    return new Promise<Result>((resolve) => {
      resolverRef.current = resolve;
      requesterRef.current = opts?.requester || (() => defaultRequest(k));
      setKind(k);
    });
  }, []);

  const handleContinue = useCallback(async () => {
    setKind(null);
    const req = requesterRef.current || (() => defaultRequest('camera'));
    requesterRef.current = null;
    const res = await req();
    resolverRef.current?.(res);
    resolverRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setKind(null);
    requesterRef.current = null;
    resolverRef.current?.({ granted: false, canAskAgain: true });
    resolverRef.current = null;
  }, []);

  return (
    <PermissionsContext.Provider value={{ requestWithNotice }}>
      {children}
      <NoticeAtCollection kind={kind} onContinue={handleContinue} onCancel={handleCancel} />
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions outside provider');
  return ctx;
}

async function defaultRequest(kind: PermissionKind): Promise<Result> {
  try {
    if (kind === 'photos') {
      const r = await ImagePicker.requestMediaLibraryPermissionsAsync();
      return { granted: r.granted, canAskAgain: r.canAskAgain };
    }
    if (kind === 'location') {
      const r = await Location.requestForegroundPermissionsAsync();
      return { granted: r.granted, canAskAgain: r.canAskAgain };
    }
    if (kind === 'microphone') {
      const r = await AudioModule.requestRecordingPermissionsAsync();
      return { granted: !!r.granted, canAskAgain: (r as any).canAskAgain ?? true };
    }
    // camera is handled via hook on call-site (useCameraPermissions); fall through
  } catch {}
  return { granted: false };
}

// Re-export camera permissions hook for parity
export { useCameraPermissions };
