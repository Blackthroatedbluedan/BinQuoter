
export interface Job {
  id: string;
  customer: string;
  driveHours: number | null;
  buildType: 'New' | 'Extension' | 'Old';
  manufacturer: 'Brock' | 'Westeel' | 'GenericCorp';
  diameter: number;
  rings: number;
  bushels: number;
  manHours: number;
  crewSize: number | null;
  sidedraw: boolean;
  stirator: boolean;
  topDry: boolean;
  daySweep: boolean;
  hopperBin: boolean;
}

export type SortConfig = {
  key: keyof Job;
  direction: 'ascending' | 'descending';
} | null;

export interface RecommendationParams {
    desiredBushels: number;
    sidedraw: boolean;
    stirator: boolean;
    topDry: boolean;
    daySweep: boolean;
    hopperBin: boolean;
}

export interface BinRecommendation {
    recommendedDiameter: number;
    recommendedRings: number;
    predictedHours: number;
    reasoning: string;
}

export interface PredictionParams {
    diameter: number;
    rings: number;
    crewSize: number;
    driveHours: number;
    sidedraw: boolean;
    stirator: boolean;
    topDry: boolean;
    daySweep: boolean;
    hopperBin: boolean;
}

export interface ManHourPrediction {
    predictedHours: number;
    reasoning: string;
}

export interface QuoteParams {
    diameter: number;
    rings: number;
    labourers: number;
    foremen: number;
    driveHours: number;
    sidedraw: boolean;
    stirator: boolean;
    topDry: boolean;
    daySweep: boolean;
    hopperBin: boolean;
    machineRental: boolean;
    manufacturer: string;
    targetMargin: number;
    safetyBuffer: number;
}

export interface QuoteResult {
    rawPredictedHours: number;
    predictedHours: number;
    buildDays: number;
    bushelsK: number;
    billingRate: number;
    hotelCost: number;
    dieselCost: number;
    machineCost: number;
    totalQuote: number;
    internalLabor: number;
    internalDriveLabor: number;
    totalInternalCost: number;
    grossMargin: number;
    marginPct: number;
    needsHotel: boolean;
    hotelRooms: number;
    hotelNights: number;
    totalKm: number;
    crewSize: number;
    reasoning: string;
}