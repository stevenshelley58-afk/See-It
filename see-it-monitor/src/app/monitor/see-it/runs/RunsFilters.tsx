'use client';

interface RunsFiltersProps {
  flow?: string;
  env?: string;
  status?: string;
  search?: string;
}

export default function RunsFilters({ flow, env, status, search }: RunsFiltersProps) {
  return (
    <form method="get" className="card p-4 flex flex-wrap gap-4">
      <select
        name="flow"
        defaultValue={flow || 'all'}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="all">All Flows</option>
        <option value="cleanup">Cleanup</option>
        <option value="placement_v2">Placement v2</option>
        <option value="product_prep">Product Prep</option>
      </select>

      <select
        name="env"
        defaultValue={env || 'all'}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="all">All Envs</option>
        <option value="prod">Prod</option>
        <option value="preview">Preview</option>
        <option value="dev">Dev</option>
      </select>

      <select
        name="status"
        defaultValue={status || 'all'}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="all">All Status</option>
        <option value="ok">OK</option>
        <option value="divergent">Divergent</option>
        <option value="error">Error</option>
        <option value="ui_mismatch">UI Mismatch</option>
        <option value="validator_fail">Validator Fail</option>
      </select>

      <input
        type="text"
        name="search"
        placeholder="Search traceId, shop, productId..."
        defaultValue={search || ''}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
    </form>
  );
}

