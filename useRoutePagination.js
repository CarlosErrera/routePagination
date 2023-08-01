import { ref, watch, computed, reactive } from '@vue/composition-api';
import router, { useRouter } from 'host/router';
import { camelToUnderscore } from './filter';
import useQueryWatching from './useQueryWatching';
import useFetchMode from './useFetchMode';

export const DEFAULT_PER_PAGE = 20;
export const DEFAULT_PAGE = 1;

/**
 *
 * @param store
 * @param opt {{actionName: string, sortKey: string, sortDescKey: string, pageKey: string, perPageKey: perPageKey, filters: any[]}}
 * @returns {{incCurrentPageByMoreMode: incCurrentPageByMoreMode, fetchItems: fetchItems, canShowPagination: ComputedRef<boolean>, totalRows: Ref<UnwrapRef<number>>, filters: UnwrapRef<{}>, dataMeta: ComputedRef<{of: null extends Ref<infer V> ? UnwrapRefSimple<V> : UnwrapRefSimple<null> | any, from, to}>, isSortDirDesc: *, perPage: Ref<UnwrapRef<number>>, updateRouteQuery: updateRouteQuery, applyFilters: applyFilters, sortBy: *, canShowLoadMore: ComputedRef<boolean>, canShowBottomNavigation: ComputedRef<unknown>, currentPage: Ref<UnwrapRef<number>>, items: null}}
 */
export default function useRoutePagination(store, opt = {}) {
    const actionName = opt.actionName ?? 'fetchList';

    const newPageKey = opt.pageKey ?? 'page';
    const perPageKey = opt.perPageKey ?? 'per_page';

    const filterKeys = [newPageKey, perPageKey, ...(opt.filters ? opt.filters : [])];
    const mutations = {
        [newPageKey]: v => parseInt(v ? v : DEFAULT_PAGE),
        [perPageKey]: v => parseInt(v ? v : DEFAULT_PER_PAGE)
    };

    const items = ref(null);
    const totalRows = ref(0);

    const { route } = useRouter();

    const filters = reactive({});
    const queryParams = reactive({});
    const routeParams = reactive({});

    const { disableQueryWatching, enableQueryWatching, hasEnableQueryWatching } = useQueryWatching();

    const initParams = () => {
        for (let i of filterKeys) {
            let key = camelToUnderscore(i);
            routeParams[key] = computed(() =>
                typeof mutations[key] === 'function' ? mutations[key](route.value.query[key]) : route.value.query[key]
            );
            queryParams[key] = ref(routeParams[key].value);
            filters[i] = ref(routeParams[key].value);
        }
    };

    initParams();

    watch(route, () => {
        disableQueryWatching();
        for (let i of filterKeys) {
            let key = camelToUnderscore(i);
            if (typeof route.value.query !== 'undefined') {
                queryParams[key].value = route.value.query[key];
                filters[i].value = route.value.query[key];
            }
        }

        enableQueryWatching();
    });

    watch(routeParams, () => {
        fetchItems();
    });

    watch(queryParams, () => {
        if (hasEnableQueryWatching.value) {
            updateRouteQuery();
        }
    });

    const updateRouteQuery = () => {
        let query = {};

        for (let i in queryParams) {
            if (queryParams[i].value) {
                query[camelToUnderscore(i)] = queryParams[i].value;
            }
        }

        const queryIsChanged = ref(Object.keys(query).length !== Object.keys(route.value.query).length);
        for (let i in query) {
            // В роуте все числа строки, поэтому слабое сравнение
            // noinspection EqualityComparisonWithCoercionJS
            if (query[i] != route.value.query[i]) {
                queryIsChanged.value = true;
            }
        }

        if (queryIsChanged.value) {
            router.replace({
                name: route.name,
                query: query
            });
        }
    };

    const applyFilters = () => {
        disableQueryWatching();
        for (let i in filters) {
            queryParams[camelToUnderscore(i)].value = filters[i].value;
        }
        clearPagination();
        // TODO Иногда не хватает nextTick
        setTimeout(() => {
            enableQueryWatching();
            updateRouteQuery();
        }, 100);
    };
    const clearFilters = id => {
        if (id) {
            document
                .getElementById(id)
                .querySelectorAll('.table_th_sort')
                .forEach(it => {
                    it.setAttribute('aria-sort', 'none');
                });
        }
        for (let i in filters) {
            filters[i].value = null;
        }
        applyFilters();
    };

    const clearPagination = () => {
        queryParams[newPageKey].value = DEFAULT_PAGE;
        queryParams[perPageKey].value = DEFAULT_PER_PAGE;
    };

    const { hasNextMode, setMoreMode, setNextMode } = useFetchMode();

    const fetchItems = () => {
        if (hasNextMode.value) {
            fetchNextItems();
        } else {
            fetchMoreItems();
        }
    };

    const fetchNextItems = callback => {
        fetch(data => {
            items.value = data;
        }, callback);
    };

    const fetchMoreItems = callback => {
        fetch(data => {
            items.value.push(...data);
        }, callback);
    };

    const incCurrentPageByMoreMode = callback => {
        callback.target.blur();
        setMoreMode();
        queryParams[newPageKey].value++;
    };

    // метод приватный, его не возвращаем
    const fetch = (setResult, callback) => {
        if (typeof store._actions[actionName] === 'undefined') {
            throw new Error('action "' + actionName + '" not found in store');
        }

        let payload = {};

        for (let i in queryParams) {
            payload[camelToUnderscore(i)] = routeParams[i].value;
        }

        store
            .dispatch(actionName, payload)
            .then(response => {
                const { data, total } = response.data;
                totalRows.value = total;
                setResult(data, total);

                if (total > 0 && items.value.length === 0) {
                    clearPagination();
                }

                if (callback !== null && typeof callback === 'function') {
                    callback(data);
                }
                setNextMode();
            })
            .catch(() => {
                clearFilters();
            });
    };

    const canShowLoadMore = computed(
        () => queryParams[newPageKey].value * queryParams[perPageKey].value < totalRows.value
    );
    const canShowPagination = computed(() => queryParams[perPageKey].value < totalRows.value);
    const canShowBottomNavigation = computed(() => canShowLoadMore || canShowPagination);
    const enabledSearchButton = computed(() => {
        for (let i in filters) {
            if (![perPageKey, newPageKey].includes(i) && filters[i].value) {
                return true;
            }
        }
        return false;
    });

    const ascDescMap = {
        asc: 'ascending',
        desc: 'descending'
    };
    filterKeys
        .filter(it => it.includes('sort_'))
        .forEach(it => {
            setTimeout(() => {
                const col = document.querySelector(`[sort-col="${it}"]`);
                if (ascDescMap[filters[it].value]) {
                    col.parentNode.setAttribute('aria-sort', ascDescMap[filters[it].value]);
                }
                col.onclick = () => {
                    setTimeout(() => {
                        const sortCols = {
                            ascending: 'asc',
                            descending: 'desc'
                        };
                        filters[it].value = sortCols[col.parentNode.getAttribute('aria-sort')];
                        applyFilters();
                    });
                };
            }, 500);
        });

    return {
        incCurrentPageByMoreMode,
        fetchItems,
        updateRouteQuery,
        applyFilters,
        clearFilters,
        items,
        totalRows,

        perPage: queryParams[perPageKey],
        currentPage: queryParams[newPageKey],
        filters,

        canShowLoadMore,
        canShowPagination,
        canShowBottomNavigation,

        enabledSearchButton
    };
}
