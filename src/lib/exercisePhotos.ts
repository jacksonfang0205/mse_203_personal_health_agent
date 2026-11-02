/**
 * Exercise photos (start and end position) from free-exercise-db, public
 * domain. Files live in public/exercises/<catalog id>-0.jpg and -1.jpg.
 * Exercises without a faithful match have no photo and show an illustrated
 * card instead, so a picture never shows the wrong movement.
 */
const WITH_PHOTOS = new Set([
  "back_squat",
  "band_pull_apart",
  "band_squat",
  "bench_press",
  "bike_intervals",
  "bike_steady",
  "brisk_walk",
  "bw_squat",
  "cable_row",
  "cat_cow",
  "db_bench",
  "db_curl",
  "db_floor_press",
  "db_lateral_raise",
  "db_rdl",
  "db_row",
  "db_shoulder_press",
  "db_split_squat",
  "dead_bug",
  "deadlift",
  "easy_run",
  "face_pull",
  "glute_bridge",
  "goblet_squat",
  "hip_circles",
  "incline_push_up",
  "incline_walk",
  "jump_rope",
  "kb_swing",
  "lat_pulldown",
  "low_lunge",
  "mountain_climber",
  "overhead_press",
  "pilates_bridge",
  "pilates_swimming",
  "plank",
  "pull_up",
  "push_up",
  "reverse_lunge",
  "row_steady",
  "run_intervals",
  "shoulder_cars",
  "squat_jump",
  "standing_hamstring",
  "step_up",
  "yoga_wind_down",
]);

export function exercisePhotos(id: string): [string, string] | null {
  return WITH_PHOTOS.has(id) ? [`/exercises/${id}-0.jpg`, `/exercises/${id}-1.jpg`] : null;
}
