import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface PINLockProps {
  open: boolean;
  onUnlock: (token: string) => void;
  onClose: () => void;
}

export default function PINLock({ open, onUnlock, onClose }: PINLockProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const handleUnlock = async () => {
    setIsVerifying(true);
    try {
      const response = await fetch("/api/admin/licenses/verify-pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ pin }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) {
        setError(data.message || "Incorrect PIN. Please try again.");
        setPin("");
        return;
      }
      setPin("");
      setError("");
      onUnlock(data.token);
    } catch {
      setError("Could not verify the PIN. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && pin.length === 4 && !isVerifying) {
      handleUnlock();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[400px]" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            <DialogTitle>Licenses Tab Locked</DialogTitle>
          </div>
          <DialogDescription>
            Enter the 4-digit PIN to access the Licenses tab
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div>
            <label className="text-sm font-medium block mb-2">PIN Code</label>
            <Input
              type="password"
              placeholder="••••"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
              }}
              onKeyDown={handleKeyDown}
              maxLength={4}
              inputMode="numeric"
              className="text-center text-2xl tracking-widest"
              autoFocus
            />
          </div>

          <Button
            onClick={handleUnlock}
            disabled={pin.length !== 4 || isVerifying}
            className="w-full"
          >
            Unlock
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
