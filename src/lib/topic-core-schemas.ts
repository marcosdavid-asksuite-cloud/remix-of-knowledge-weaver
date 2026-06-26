// Core schema of expected DataPoint fields per topic slug.
// This is the "DataPoint Oficial" definition embedded in code (no DB table).

export type CoreFieldDef = {
  name: string;
  type: "string" | "number" | "time" | "boolean" | "money" | "enum" | "text";
  description: string;
  enumValues?: string[];
};

export const TOPIC_CORE_SCHEMAS: Record<string, CoreFieldDef[]> = {
  breakfast: [
    { name: "start_time", type: "time", description: "Horário inicial do café da manhã" },
    { name: "end_time", type: "time", description: "Horário final do café da manhã" },
    { name: "location", type: "string", description: "Local onde o café é servido" },
    { name: "included_in_rate", type: "boolean", description: "Incluso na diária?" },
    { name: "price", type: "money", description: "Valor avulso do café da manhã" },
    { name: "menu_summary", type: "text", description: "Resumo do que é servido" },
  ],
  check_in: [
    { name: "start_time", type: "time", description: "Horário a partir do qual o check-in é permitido" },
    { name: "early_check_in", type: "boolean", description: "Permite check-in antecipado?" },
    { name: "early_check_in_fee", type: "money", description: "Valor de check-in antecipado" },
    { name: "required_documents", type: "text", description: "Documentos necessários" },
  ],
  check_out: [
    { name: "end_time", type: "time", description: "Horário limite do check-out" },
    { name: "late_check_out", type: "boolean", description: "Permite late check-out?" },
    { name: "late_check_out_fee", type: "money", description: "Valor de late check-out" },
  ],
  pool: [
    { name: "open_time", type: "time", description: "Horário de abertura" },
    { name: "close_time", type: "time", description: "Horário de fechamento" },
    { name: "heated", type: "boolean", description: "Piscina aquecida?" },
    { name: "kids_pool", type: "boolean", description: "Possui piscina infantil?" },
    { name: "location", type: "string", description: "Localização" },
  ],
  parking: [
    { name: "available", type: "boolean", description: "Estacionamento disponível?" },
    { name: "valet", type: "boolean", description: "Possui valet?" },
    { name: "price_per_day", type: "money", description: "Diária do estacionamento" },
    { name: "included_in_rate", type: "boolean", description: "Incluso na diária?" },
  ],
  restaurant: [
    { name: "name", type: "string", description: "Nome do restaurante" },
    { name: "cuisine", type: "string", description: "Tipo de cozinha" },
    { name: "lunch_start", type: "time", description: "Início do almoço" },
    { name: "lunch_end", type: "time", description: "Fim do almoço" },
    { name: "dinner_start", type: "time", description: "Início do jantar" },
    { name: "dinner_end", type: "time", description: "Fim do jantar" },
    { name: "reservation_required", type: "boolean", description: "Precisa de reserva?" },
  ],
  gym: [
    { name: "open_time", type: "time", description: "Horário de abertura" },
    { name: "close_time", type: "time", description: "Horário de fechamento" },
    { name: "personal_trainer", type: "boolean", description: "Possui personal trainer?" },
    { name: "location", type: "string", description: "Localização" },
  ],
  wifi: [
    { name: "available", type: "boolean", description: "Wi-Fi disponível?" },
    { name: "free", type: "boolean", description: "Wi-Fi gratuito?" },
    { name: "network_name", type: "string", description: "Nome da rede" },
    { name: "password", type: "string", description: "Senha" },
  ],
  transfer: [
    { name: "available", type: "boolean", description: "Transfer disponível?" },
    { name: "price", type: "money", description: "Valor" },
    { name: "destinations", type: "text", description: "Destinos atendidos" },
  ],
  pets: [
    { name: "allowed", type: "boolean", description: "Aceita pets?" },
    { name: "max_weight_kg", type: "number", description: "Peso máximo (kg)" },
    { name: "fee", type: "money", description: "Taxa para pets" },
  ],
  rooms: [
    { name: "types", type: "text", description: "Tipos de quarto" },
    { name: "amenities", type: "text", description: "Comodidades padrão" },
    { name: "air_conditioning", type: "boolean", description: "Possui ar-condicionado?" },
  ],
  amenities: [
    { name: "spa", type: "boolean", description: "Possui spa?" },
    { name: "business_center", type: "boolean", description: "Possui centro de negócios?" },
    { name: "kids_club", type: "boolean", description: "Possui kids club?" },
  ],
};

export function getCoreSchema(slug: string): CoreFieldDef[] {
  return TOPIC_CORE_SCHEMAS[slug] ?? [];
}
