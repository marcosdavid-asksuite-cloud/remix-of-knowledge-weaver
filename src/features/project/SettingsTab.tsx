import { ExtractionSettingsTab } from "@/features/settings/ExtractionSettingsTab";
import { DataPointsTab } from "@/features/settings/DataPointsTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export function SettingsTab() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Settings</CardTitle>
          <p className="text-xs text-muted-foreground">
            Configurações da pipeline de extração e definição dos data points oficiais.
            As credenciais do provider LLM ficam na aba <strong>Compare Responses</strong>.
          </p>
        </CardHeader>
      </Card>

      <Tabs defaultValue="pipeline">
        <TabsList>
          <TabsTrigger value="pipeline">Extraction Pipeline</TabsTrigger>
          <TabsTrigger value="data_points">Data Point Definitions</TabsTrigger>
        </TabsList>
        <TabsContent value="pipeline" className="mt-4">
          <ExtractionSettingsTab />
        </TabsContent>
        <TabsContent value="data_points" className="mt-4">
          <DataPointsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
