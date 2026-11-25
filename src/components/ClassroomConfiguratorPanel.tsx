import { useMemo, useState } from 'react';
import { Ban, CheckCircle2, Copy, Eye, Plus, Trash2 } from 'lucide-react';
import {
  benchKey,
  calculateClassroomCapacity,
  calculateTotalCapacity,
  generateSimpleClassrooms,
  getBenchesInRow
} from '../core/classroomEngine';
import { ClassroomConfig, SeatingMode } from '../core/types';

interface Props {
  classrooms: ClassroomConfig[];
  seatingMode: SeatingMode;
  studentCount: number;
  onChange: (classrooms: ClassroomConfig[]) => void;
}

export function ClassroomConfiguratorPanel({
  classrooms,
  seatingMode,
  studentCount,
  onChange
}: Props) {
  const [setupMode, setSetupMode] = useState<'simple' | 'advanced'>(
    classrooms.length > 0 && classrooms.some((c) => c.building || c.floor || (c.disabledBenches && c.disabledBenches.length > 0))
      ? 'advanced'
      : 'simple'
  );

  // Simple Mode Inputs
  const [simpleRooms, setSimpleRooms] = useState(classrooms.length || 5);
  const [simpleRows, setSimpleRows] = useState(classrooms[0]?.rows || 3);
  const [simpleBenches, setSimpleBenches] = useState(classrooms[0]?.benchesPerRow || 10);

  // Selected room for visual layout preview
  const [previewRoomId, setPreviewRoomId] = useState<string>(classrooms[0]?.id || '');

  const capacitySummary = useMemo(
    () => calculateTotalCapacity(classrooms, seatingMode),
    [classrooms, seatingMode]
  );

  const activePreviewRoom = useMemo(
    () => classrooms.find((c) => c.id === previewRoomId) ?? classrooms[0] ?? null,
    [classrooms, previewRoomId]
  );

  const handleApplySimple = () => {
    const generated = generateSimpleClassrooms(simpleRooms, simpleRows, simpleBenches);
    onChange(generated);
    if (generated[0]) setPreviewRoomId(generated[0].id);
  };

  const handleAddRoom = () => {
    const nextIdx = classrooms.length + 1;
    const newRoom: ClassroomConfig = {
      id: `room_${Date.now()}_${nextIdx}`,
      name: `Classroom ${nextIdx}`,
      roomNumber: `${nextIdx}`,
      rows: 3,
      benchesPerRow: 10,
      disabledBenches: [],
      disabled: false,
      orderIndex: classrooms.length
    };
    const next = [...classrooms, newRoom];
    onChange(next);
    setPreviewRoomId(newRoom.id);
  };

  const updateRoom = (id: string, patch: Partial<ClassroomConfig>) => {
    onChange(classrooms.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const duplicateRoom = (room: ClassroomConfig) => {
    const nextIdx = classrooms.length + 1;
    const copy: ClassroomConfig = {
      ...room,
      id: `room_${Date.now()}_${nextIdx}`,
      name: `${room.name} (Copy)`,
      roomNumber: `${room.roomNumber}-B`,
      orderIndex: classrooms.length
    };
    onChange([...classrooms, copy]);
    setPreviewRoomId(copy.id);
  };

  const deleteRoom = (id: string) => {
    const filtered = classrooms
      .filter((c) => c.id !== id)
      .map((c, idx) => ({ ...c, orderIndex: idx }));
    onChange(filtered);
    if (previewRoomId === id && filtered[0]) {
      setPreviewRoomId(filtered[0].id);
    }
  };

  const toggleDisabledBench = (room: ClassroomConfig, r: number, b: number) => {
    const key = benchKey(r, b);
    const existing = new Set(room.disabledBenches ?? []);
    if (existing.has(key)) {
      existing.delete(key);
    } else {
      existing.add(key);
    }
    updateRoom(room.id, { disabledBenches: Array.from(existing) });
  };

  const sufficient = studentCount <= capacitySummary.totalCapacity;

  return (
    <div className="space-y-6">
      {/* Live Capacity Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-white border border-slate-200 rounded-xl p-4">
        <div>
          <div className="text-[11px] text-slate-500">Active Classrooms</div>
          <div className="font-mono text-lg font-bold text-slate-900 tabular-nums">
            {capacitySummary.activeClassrooms} / {capacitySummary.totalClassrooms}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Active Benches</div>
          <div className="font-mono text-lg font-bold text-slate-900 tabular-nums">
            {capacitySummary.activeBenches}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Available Seats ({seatingMode}/bench)</div>
          <div className="font-mono text-lg font-bold text-slate-900 tabular-nums">
            {capacitySummary.totalCapacity}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Students to Seat</div>
          <div className="font-mono text-lg font-bold text-slate-900 tabular-nums">{studentCount}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Capacity Status</div>
          <div
            className={`text-sm font-semibold mt-0.5 ${
              sufficient ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {sufficient
              ? `OK (+${capacitySummary.totalCapacity - studentCount} spare)`
              : `Short by ${studentCount - capacitySummary.totalCapacity}`}
          </div>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setSetupMode('simple')}
          className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors ${
            setupMode === 'simple'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Mode A: Simple Configuration
        </button>
        <button
          type="button"
          onClick={() => setSetupMode('advanced')}
          className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors ${
            setupMode === 'advanced'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Mode B: Advanced Room Editor
        </button>
      </div>

      {/* Mode A: Simple Configuration */}
      {setupMode === 'simple' && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Uniform Classroom Generator</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Automatically creates Classroom 1 through Classroom N with identical row and bench layouts.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Total Number of Classrooms
              </label>
              <input
                type="number"
                min={1}
                max={500}
                value={simpleRooms}
                onChange={(e) => setSimpleRooms(Math.max(1, Number(e.target.value)))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Rows in Each Classroom
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={simpleRows}
                onChange={(e) => setSimpleRows(Math.max(1, Number(e.target.value)))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Benches in Each Row
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={simpleBenches}
                onChange={(e) => setSimpleBenches(Math.max(1, Number(e.target.value)))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-600 font-mono tabular-nums">
              Generates {simpleRooms} classrooms · {simpleRooms * simpleRows * simpleBenches} total benches ·{' '}
              {simpleRooms * simpleRows * simpleBenches * seatingMode} total seats
            </div>
            <button
              type="button"
              onClick={handleApplySimple}
              className="px-4 py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Generate {simpleRooms} Classrooms
            </button>
          </div>
        </div>
      )}

      {/* Mode B: Advanced Individual Classroom Editor */}
      {setupMode === 'advanced' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-900">
              Individual Classroom Configurations ({classrooms.length})
            </h4>
            <button
              type="button"
              onClick={handleAddRoom}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Classroom
            </button>
          </div>

          <div className="space-y-3">
            {classrooms.map((room) => {
              const stats = calculateClassroomCapacity(room, seatingMode);
              return (
                <div
                  key={room.id}
                  className={`bg-white border rounded-xl p-4 space-y-3 ${
                    room.disabled ? 'border-slate-200 bg-slate-50/70 opacity-75' : 'border-slate-200'
                  }`}
                >
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 items-end">
                    <div className="col-span-2 sm:col-span-2">
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Classroom Name
                      </label>
                      <input
                        type="text"
                        value={room.name}
                        onChange={(e) => updateRoom(room.id, { name: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Room No.
                      </label>
                      <input
                        type="text"
                        value={room.roomNumber}
                        onChange={(e) => updateRoom(room.id, { roomNumber: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Building
                      </label>
                      <input
                        type="text"
                        value={room.building ?? ''}
                        onChange={(e) => updateRoom(room.id, { building: e.target.value })}
                        placeholder="Main Block"
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Rows
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={room.rows}
                        onChange={(e) =>
                          updateRoom(room.id, { rows: Math.max(1, Number(e.target.value)) })
                        }
                        className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Benches/Row
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={room.benchesPerRow}
                        onChange={(e) =>
                          updateRoom(room.id, {
                            benchesPerRow: Math.max(1, Number(e.target.value))
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-200 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                    <div className="text-slate-600 font-mono tabular-nums">
                      Active Benches: {stats.activeBenches} · Capacity: {stats.capacity} seats
                      {stats.disabledBenches > 0 && ` · ${stats.disabledBenches} disabled bench(es)`}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewRoomId(room.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Inspect Benches
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicateRoom(room)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => updateRoom(room.id, { disabled: !room.disabled })}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md ${
                          room.disabled
                            ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                            : 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                        }`}
                      >
                        {room.disabled ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Enable
                          </>
                        ) : (
                          <>
                            <Ban className="w-3.5 h-3.5" />
                            Disable
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRoom(room.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 rounded-md"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Visual Classroom Layout Preview (Click benches to disable/enable) */}
      {activePreviewRoom && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">
                Visual Classroom Bench Preview
              </h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Click any bench to mark it disabled (e.g., damaged desk or reserved space). Disabled benches are skipped automatically.
              </p>
            </div>
            <select
              value={activePreviewRoom.id}
              onChange={(e) => setPreviewRoomId(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg bg-white"
            >
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (Room {c.roomNumber}) {c.disabled ? '— Disabled' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3 overflow-x-auto pb-2">
            {Array.from({ length: activePreviewRoom.rows }, (_, rIdx) => {
              const rNum = rIdx + 1;
              const benchCount = getBenchesInRow(activePreviewRoom, rIdx);
              const disabledSet = new Set(activePreviewRoom.disabledBenches ?? []);
              return (
                <div key={rNum} className="flex items-center gap-3 min-w-max">
                  <div className="w-16 text-xs font-semibold text-slate-500 shrink-0">
                    Row {rNum}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: benchCount }, (_, bIdx) => {
                      const bNum = bIdx + 1;
                      const isDisabled =
                        activePreviewRoom.disabled || disabledSet.has(benchKey(rNum, bNum));
                      return (
                        <button
                          key={bNum}
                          type="button"
                          disabled={activePreviewRoom.disabled}
                          onClick={() => toggleDisabledBench(activePreviewRoom, rNum, bNum)}
                          title={`Row ${rNum} Bench ${bNum} (${isDisabled ? 'Disabled' : `${seatingMode} seat(s)`})`}
                          className={`px-2.5 py-1.5 rounded-md border text-[11px] font-mono tabular-nums transition-colors ${
                            isDisabled
                              ? 'bg-slate-100 border-slate-200 text-slate-400 line-through'
                              : 'bg-blue-50/60 border-blue-200 text-blue-900 hover:bg-blue-100'
                          }`}
                        >
                          B{bNum}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
