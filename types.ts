
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