import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Clock, Gauge, Save, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import LicenseManagement from "./LicenseManagement";
import PINLock from "./PINLock";
import { SettingRow, SettingsSection } from "./settings/SettingsSection";
import type {
  GetQueueSettingsResponse,
  UpdateQueueSettingsResponse,
} from "@shared/api";

export default function AdminSettings() {
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [activeTab, setActiveTab] = useState("queue");
  const [licensesUnlockToken, setLicensesUnlockToken] = useState<string | null>(null);
  const [showPINLock, setShowPINLock] = useState(false);

  // Queue Settings
  const [queueSettings, setQueueSettings] = useState({
    maxTicketsPerDay: 200,
    fifoMode: true,
    dailyResetTime: "00:00",
  });

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch("/api/admin/queue-settings", {
          headers: {
            "X-Requested-With": "XMLHttpRequest",
          },
        });
        if (!response.ok) {
          throw new Error("Failed to load settings");
        }
        const data: GetQueueSettingsResponse = await response.json();
        const { settings } = data;
        setQueueSettings({
          maxTicketsPerDay: settings.maxTicketsPerDay,
          fifoMode: settings.fifoMode,
          dailyResetTime: settings.dailyResetTimeUtc,
        });
      } catch (error) {
        console.error("Failed to load queue settings", error);
        toast.error("Failed to load queue settings");
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);


  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/admin/queue-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          maxTicketsPerDay: queueSettings.maxTicketsPerDay,
          dailyResetTimeUtc: queueSettings.dailyResetTime,
          fifoMode: queueSettings.fifoMode,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save settings");
      }
      const data: UpdateQueueSettingsResponse = await response.json();
      toast.success(data.message);
      setUnsavedChanges(false);
    } catch (error) {
      console.error("Failed to save settings", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to save settings",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleTabChange = (value: string) => {
    if (value === "licenses" && !licensesUnlockToken) {
      setShowPINLock(true);
    } else if (value !== "licenses" && licensesUnlockToken) {
      // Auto-lock when switching away from Licenses tab
      setLicensesUnlockToken(null);
      setActiveTab(value);
    } else {
      setActiveTab(value);
    }
  };

  const handlePINUnlock = (token: string) => {
    setLicensesUnlockToken(token);
    setShowPINLock(false);
    setActiveTab("licenses");
  };

  // Auto-lock when component unmounts (navigating away from Settings page)
  useEffect(() => {
    return () => {
      setLicensesUnlockToken(null);
    };
  }, []);


  return (
    <div className="space-y-4">
      <PINLock
        open={showPINLock}
        onUnlock={handlePINUnlock}
        onClose={() => setShowPINLock(false)}
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="queue">Queue Configuration</TabsTrigger>
          <TabsTrigger value="licenses">Licenses</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="space-y-6">
          {unsavedChanges && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                You have unsaved changes. Please save before leaving this page.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <SettingsSection
              icon={Gauge}
              title="Queue Limits"
              description="Set the maximum number of tickets allowed per day."
            >
              <SettingRow
                htmlFor="maxTickets"
                label="Maximum Tickets Per Day"
                description="Limit new tickets when this threshold is reached"
              >
                <Input
                  id="maxTickets"
                  type="number"
                  className="tabular-nums"
                  value={queueSettings.maxTicketsPerDay}
                  onChange={(e) => {
                    setQueueSettings({
                      ...queueSettings,
                      maxTicketsPerDay: parseInt(e.target.value),
                    });
                    setUnsavedChanges(true);
                  }}
                  min={1}
                  max={1000}
                />
              </SettingRow>
            </SettingsSection>

            <SettingsSection
              icon={Clock}
              title="Daily Reset Schedule"
              description="Choose when the queue counters reset each day."
            >
              <SettingRow
                htmlFor="resetTime"
                label="Daily Reset Time (UTC)"
                description="Time when queue counters reset daily"
              >
                <Input
                  id="resetTime"
                  type="time"
                  className="tabular-nums"
                  value={queueSettings.dailyResetTime}
                  onChange={(e) => {
                    setQueueSettings({
                      ...queueSettings,
                      dailyResetTime: e.target.value,
                    });
                    setUnsavedChanges(true);
                  }}
                />
              </SettingRow>
            </SettingsSection>

            <SettingsSection
              icon={SlidersHorizontal}
              title="Queue Processing Behavior"
              description="Define how customers are selected and served."
              className="lg:col-span-2"
            >
              <SettingRow
                htmlFor="queueBehavior"
                label="Queue Behavior"
                description="How customers are selected to be served"
              >
                <Select
                  value={queueSettings.fifoMode ? "fifo" : "priority"}
                  onValueChange={(value) => {
                    setQueueSettings({
                      ...queueSettings,
                      fifoMode: value === "fifo",
                    });
                    setUnsavedChanges(true);
                  }}
                >
                  <SelectTrigger id="queueBehavior">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fifo">
                      First-In-First-Out (FIFO)
                    </SelectItem>
                    <SelectItem value="priority">
                      Priority-Based (Future)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>
            </SettingsSection>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSaveSettings}
              disabled={!unsavedChanges || isSaving || isLoading}
            >
              <Save className="mr-2 h-4 w-4" />
              {isSaving ? "Saving..." : "Save Queue Settings"}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="licenses" className="space-y-4">
          {licensesUnlockToken && (
            <LicenseManagement unlockToken={licensesUnlockToken} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
