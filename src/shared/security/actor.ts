/** Wie een actie uitvoert (voor audit-logging en toegangscontrole); geen CRM-domeinbegrip, dus hier
 *  in `shared/` in plaats van in `modules/prospects` — vrijwel elke module heeft dit nodig. */
export interface Actor {
  id: string;
  ip?: string | null;
}
